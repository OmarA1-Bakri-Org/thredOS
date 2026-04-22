import { randomUUID } from 'crypto'
import { readSequence, writeSequence } from '../../sequence/parser'
import { validateDAG, topologicalSort } from '../../sequence/dag'
import { evaluateStepCompletionGates, isStepRunnable } from '../../gates/engine'
import { MprocsClient } from '../../mprocs/client'
import { updateStepProcess, readMprocsMap } from '../../mprocs/state'
import { runStep } from '../../runner/wrapper'
import { getRuntimeEventLogPath, saveRunArtifacts } from '../../runner/artifacts'
import {
  makeStepInputManifest,
  prepareStepPromptForDispatch,
  resolveStepPromptPath,
  validateStepPromptExists,
} from '../../runner/step-preparation'
import { assessCompletionResult, dispatch } from '../../runner/dispatch'
import { StepNotFoundError } from '../../errors'
import type { Step, Sequence, StepStatus } from '../../sequence/schema'
import { ROOT_THREAD_SURFACE_ID } from '../../thread-surfaces/constants'
import { readThreadSurfaceState, withThreadSurfaceStateRevision, writeThreadSurfaceState } from '../../thread-surfaces/repository'
import { completeRun, createReplacementRun, createRootThreadSurfaceRun } from '../../thread-surfaces/mutations'
import { beginStepRunIfSurfaceExists, finalizeStepRunWithRuntimeEvents, type StepRunScope } from '../../thread-surfaces/step-run-runtime'
import { readRuntimeEventLog, type RuntimeDelegationEvent } from '../../thread-surfaces/runtime-event-log'
import { provisionAllChildSequences } from '../../thread-surfaces/provision-child-sequence'
import { appendApproval, hasApprovedApproval } from '../../approvals/repository'
import { appendTraceEvent } from '../../traces/writer'
import {
  evaluateSequenceCondition,
  evaluateRuntimeCondition,
  buildConditionContext,
  readRuntimeContext,
} from '../../runtime/context'
import {
  AbortWorkflowError,
  assessSelectedStepEvidence,
  executeNativeOperationalAction,
  renderRuntimeContextTemplate,
} from '../../runtime/native-actions'

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
const THREADOS_EVENT_EMITTER_COMMAND = 'thread event'

interface CLIOptions {
  json: boolean
  help: boolean
  watch: boolean
  basePath?: string
}

interface RunStepResult {
  success: boolean
  stepId: string
  runId: string
  status: StepStatus
  duration?: number
  exitCode?: number | null
  artifactPath?: string
  error?: string
  abortWorkflow?: boolean
}

interface RunRunnableResult {
  success: boolean
  executed: RunStepResult[]
  skipped: string[]
  waiting: string[]
  error?: string
}

interface RunnableStepSelection {
  steps: Step[]
  skippedIds: string[]
}

interface CLIRunRuntime {
  dispatch: typeof dispatch
  runStep: typeof runStep
  saveRunArtifacts: typeof saveRunArtifacts
  runComposioTool?: (input: {
    toolSlug: string
    arguments: Record<string, unknown>
    timeoutMs?: number
  }) => Promise<unknown>
}

declare global {
  var __THREADOS_CLI_RUN_RUNTIME__: CLIRunRuntime | undefined
}

class ApprovalRequiredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ApprovalRequiredError'
  }
}

async function executeComposioTool(input: {
  toolSlug: string
  arguments: Record<string, unknown>
  timeoutMs?: number
}): Promise<unknown> {
  const command = Bun.which('composio') ?? `${process.env.HOME}/.composio/composio`
  const proc = Bun.spawn({
    cmd: [command, 'execute', input.toolSlug, '-d', JSON.stringify(input.arguments ?? {})],
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const timeout = setTimeout(() => proc.kill(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    if (exitCode !== 0) {
      throw new Error(stderr.trim() || stdout.trim() || `Composio tool '${input.toolSlug}' failed with exit code ${exitCode}`)
    }

    const trimmed = stdout.trim()
    if (!trimmed) return null
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed
    }
  } finally {
    clearTimeout(timeout)
  }
}

function getCLIRunRuntime(): CLIRunRuntime {
  return globalThis.__THREADOS_CLI_RUN_RUNTIME__ ?? {
    dispatch,
    runStep,
    saveRunArtifacts,
    runComposioTool: executeComposioTool,
  }
}

async function executeStepActions(
  basePath: string,
  sequence: Sequence,
  step: Step,
  runId: string,
  runtime: CLIRunRuntime,
  actions: Array<Record<string, unknown>> = (step.actions ?? []) as Array<Record<string, unknown>>,
): Promise<void> {
  for (const action of actions) {
    if (action.type === 'conditional') {
      const config = (action.config ?? {}) as Record<string, unknown>
      const branchContext = buildConditionContext(sequence, await readRuntimeContext(basePath))
      const branchActions = evaluateRuntimeCondition(String(config.condition ?? ''), branchContext)
        ? config.if_true
        : config.if_false
      const nestedActions = Array.isArray(branchActions)
        ? branchActions.filter((candidate): candidate is Record<string, unknown> => !!candidate && typeof candidate === 'object')
        : []
      await executeStepActions(basePath, sequence, step, runId, runtime, nestedActions)
      continue
    }

    if (action.type === 'approval') {
      const config = (action.config ?? {}) as Record<string, unknown>
      const approvalId = `apr-${randomUUID()}`
      const targetRef = typeof config.target_ref === 'string' && config.target_ref.length > 0
        ? config.target_ref
        : `step:${step.id}`
      const notes = typeof config.approval_prompt === 'string' && config.approval_prompt.length > 0
        ? await renderRuntimeContextTemplate(basePath, config.approval_prompt, await readRuntimeContext(basePath))
        : typeof action.description === 'string' && action.description.length > 0
          ? action.description
          : null

      if (await hasApprovedApproval(basePath, targetRef, 'run')) {
        continue
      }

      await appendApproval(basePath, runId, {
        id: approvalId,
        action_type: 'run',
        target_ref: targetRef,
        requested_by: 'seqctl:run',
        status: 'pending',
        approved_by: null,
        approved_at: null,
        notes,
      })
      await appendTraceEvent(basePath, runId, {
        ts: new Date().toISOString(),
        run_id: runId,
        surface_id: targetRef,
        actor: 'seqctl:run',
        event_type: 'approval-requested',
        payload_ref: approvalId,
        policy_ref: null,
      })

      throw new ApprovalRequiredError(`Awaiting approval for step '${step.id}' via action '${String(action.id ?? 'approval')}'`)
    }

    await executeNativeOperationalAction(basePath, sequence, step, runId, {
      ...runtime,
      runComposioTool: runtime.runComposioTool ?? executeComposioTool,
    }, action)
  }
}

interface ApprovalRequirement {
  targetRef: string
  actionType: 'run'
}

async function collectApprovalRequirements(
  basePath: string,
  sequence: Sequence,
  step: Step,
  actions: Array<Record<string, unknown>> = (step.actions ?? []) as Array<Record<string, unknown>>,
): Promise<ApprovalRequirement[]> {
  const requirements: ApprovalRequirement[] = []

  for (const action of actions) {
    if (action.type === 'conditional') {
      const config = (action.config ?? {}) as Record<string, unknown>
      const branchContext = buildConditionContext(sequence, await readRuntimeContext(basePath))
      const branchActions = evaluateRuntimeCondition(String(config.condition ?? ''), branchContext)
        ? config.if_true
        : config.if_false
      const nestedActions = Array.isArray(branchActions)
        ? branchActions.filter((candidate): candidate is Record<string, unknown> => !!candidate && typeof candidate === 'object')
        : []
      requirements.push(...await collectApprovalRequirements(basePath, sequence, step, nestedActions))
      continue
    }

    if (action.type !== 'approval') continue

    const config = (action.config ?? {}) as Record<string, unknown>
    requirements.push({
      actionType: 'run',
      targetRef: typeof config.target_ref === 'string' && config.target_ref.length > 0
        ? config.target_ref
        : `step:${step.id}`,
    })
  }

  return requirements
}

async function hasSatisfiedApprovalRequirements(basePath: string, sequence: Sequence, step: Step): Promise<boolean> {
  const requirements = await collectApprovalRequirements(basePath, sequence, step)
  if (requirements.length === 0) return false

  for (const requirement of requirements) {
    if (!await hasApprovedApproval(basePath, requirement.targetRef, requirement.actionType)) {
      return false
    }
  }

  return true
}

async function evaluateStepCondition(basePath: string, sequence: Sequence, step: Step): Promise<boolean> {
  return evaluateSequenceCondition(basePath, sequence, (step as Step & { condition?: string }).condition)
}

function getSurfaceId(step: Step): string {
  return step.surface_ref || `thread-${step.id}`
}

function getCompletedNodeIds(sequence: Sequence): Set<string> {
  return new Set([
    ...sequence.steps
      .filter(step => step.status === 'DONE' || step.status === 'SKIPPED')
      .map(step => step.id),
    ...sequence.gates
      .filter(gate => gate.status === 'APPROVED')
      .map(gate => gate.id),
  ])
}

async function reconcileSkippedSteps(basePath: string, sequence: Sequence): Promise<string[]> {
  const skippedIds: string[] = []
  let changed = false

  while (true) {
    const completedNodes = getCompletedNodeIds(sequence)
    let changedThisPass = false

    for (const step of sequence.steps) {
      if (step.status !== 'READY') continue
      if (!step.depends_on.every(depId => completedNodes.has(depId))) continue

      const conditionSatisfied = await evaluateStepCondition(basePath, sequence, step)
      if (conditionSatisfied) continue

      step.status = 'SKIPPED'
      skippedIds.push(step.id)
      changedThisPass = true
      changed = true
    }

    if (!changedThisPass) break
  }

  if (changed) {
    await writeSequence(basePath, sequence)
  }

  return skippedIds
}

function renderActionContract(step: Step): string {
  const actions = (step as Step & { actions?: unknown[] }).actions
  if (!Array.isArray(actions) || actions.length === 0) return ''
  return `\n\n## THREADOS ACTION CONTRACT\n${JSON.stringify(actions, null, 2)}\n`
}

/**
 * Get runnable steps (READY status with all dependencies satisfied)
 */
async function getRunnableSteps(basePath: string, sequence: Sequence): Promise<RunnableStepSelection> {
  const skippedIds = await reconcileSkippedSteps(basePath, sequence)
  const completedNodes = getCompletedNodeIds(sequence)

  const steps = (await Promise.all(sequence.steps.map(async step => {
    const eligibleStatus = step.status === 'READY'
      || (step.status === 'BLOCKED' && await hasSatisfiedApprovalRequirements(basePath, sequence, step))
    if (!eligibleStatus) return null

    const dependenciesSatisfied = step.depends_on.every(depId => completedNodes.has(depId))
    if (!dependenciesSatisfied) return null

    const conditionSatisfied = await evaluateStepCondition(basePath, sequence, step)
    return conditionSatisfied ? step : null
  }))).filter((step): step is Step => step !== null)

  return { steps, skippedIds }
}

/**
 * Execute a single step via the Agent Execution Protocol:
 * 1. Read prompt file
 * 2. Compile with context (sequence state, dependency artifacts, project info)
 *    - Shell steps skip compilation and pass raw script directly
 * 3. Dispatch to agent CLI (claude, codex, gemini, sh)
 * 4. Run via existing runner (spawn, capture, timeout)
 * 5. Map exit code to status
 */
async function executeSingleStep(
  basePath: string,
  sequence: Sequence,
  stepId: string,
  runId: string,
  _client: MprocsClient
): Promise<RunStepResult> {
  const step = sequence.steps.find(s => s.id === stepId)
  if (!step) {
    throw new StepNotFoundError(stepId)
  }

  const stepRuntime = await createStepRunScope(basePath, sequence, step)

  const promptPath = resolveStepPromptPath(basePath, step)
  const promptExists = await validateStepPromptExists(basePath, step)
  if (!promptExists) {
    // Bug fix: persist FAILED status so step isn't re-selected by run runnable
    step.status = 'FAILED'
    await writeSequence(basePath, sequence)
    await finalizeStepRunScope(basePath, step, stepRuntime, 'failed', []).catch(() => {})
    return {
      success: false,
      stepId,
      runId,
      status: 'FAILED',
      error: `Prompt file not found for step '${stepId}'. Expected: ${promptPath}`,
    }
  }

  // Update status to RUNNING
  step.status = 'RUNNING'
  await writeSequence(basePath, sequence)

  try {
    const runtime = getCLIRunRuntime()
    const runtimeEventLogPath = getRuntimeEventLogPath(basePath, runId, stepId)
    const surfaceId = getSurfaceId(step)
    const startedAt = stepRuntime.stepRun?.startedAt ?? new Date().toISOString()
    const inputManifest = makeStepInputManifest(step, runId, surfaceId, startedAt)
    await executeStepActions(basePath, sequence, step, runId, runtime)
    const preparedPrompt = await prepareStepPromptForDispatch({
      stepId,
      step,
      sequence,
      basePath,
      maxTokens: step.model === 'claude-code' ? 8000 : 4000,
      runtimeEventLogPath,
      runtimeEventEmitterCommand: THREADOS_EVENT_EMITTER_COMMAND,
    })

    // 3. Dispatch to agent (writes temp prompt, resolves CLI, checks availability)
    const runnerConfig = await runtime.dispatch(step.model, {
      stepId,
      runId,
      compiledPrompt: preparedPrompt.promptForDispatch,
      cwd: step.cwd || basePath,
      timeout: step.timeout_ms || DEFAULT_TIMEOUT_MS,
      runtimeEventLogPath,
      runtimeEventEmitterCommand: THREADOS_EVENT_EMITTER_COMMAND,
    })

    // 4. Execute via runner
    const result = await runtime.runStep(runnerConfig)

    // 5. Save artifacts
    const artifactPath = await runtime.saveRunArtifacts(basePath, result, {
      surfaceId,
      compiledPrompt: preparedPrompt.promptForDispatch,
      inputManifest,
      outputContractRef: step.output_contract_ref,
      completionContract: step.completion_contract,
    })
    const runtimeEvents = await readRuntimeEventLog(basePath, runId, stepId)

    const completionAssessment = assessCompletionResult(result)
    const explicitEvidence = await assessSelectedStepEvidence(basePath, sequence, step)
    const completionDecisions = evaluateStepCompletionGates(step, {
      artifactManifestPresent: Boolean(artifactPath),
      outputSchemaValid: step.output_contract_ref ? explicitEvidence.outputSchemaValid : true,
      completionContractSatisfied: step.completion_contract ? explicitEvidence.completionContractSatisfied : true,
    })
    const completionPassed = isStepRunnable(completionDecisions)

    // 6. Map completion to step status
    let newStatus = completionAssessment.status
    if (newStatus === 'DONE' && !completionPassed) {
      newStatus = 'NEEDS_REVIEW'
    }
    step.status = newStatus
    await writeSequence(basePath, sequence)
    await finalizeStepRunScope(basePath, step, stepRuntime, newStatus === 'DONE' ? 'successful' : 'failed', runtimeEvents.events)

    return {
      success: newStatus === 'DONE',
      stepId,
      runId,
      status: step.status,
      duration: result.duration,
      exitCode: result.exitCode,
      artifactPath,
    }
  } catch (error) {
    step.status = error instanceof ApprovalRequiredError ? 'BLOCKED' : 'FAILED'
    try {
      await writeSequence(basePath, sequence)
    } catch (writeError) {
      console.error(
        `Failed to persist failed step '${stepId}' for run '${runId}':`,
        writeError
      )
    }
    await finalizeStepRunScope(
      basePath,
      step,
      stepRuntime,
      error instanceof ApprovalRequiredError ? 'pending' : 'failed',
      [],
    ).catch(() => {})

    return {
      success: false,
      stepId,
      runId,
      status: step.status,
      error: error instanceof Error ? error.message : String(error),
      abortWorkflow: error instanceof AbortWorkflowError,
    }
  }
}

async function createRootRunScopeForCommand(basePath: string, sequenceName: string, runId: string, startedAt: string) {
  const currentState = await readThreadSurfaceState(basePath)
  const executionIndex = currentState.runs.length + 1
  const nextState = currentState.threadSurfaces.some(surface => surface.id === ROOT_THREAD_SURFACE_ID)
    ? createReplacementRun(currentState, {
        threadSurfaceId: ROOT_THREAD_SURFACE_ID,
        runId,
        startedAt,
        executionIndex,
      }).state
    : createRootThreadSurfaceRun(currentState, {
        surfaceId: ROOT_THREAD_SURFACE_ID,
        surfaceLabel: sequenceName,
        createdAt: startedAt,
        runId,
        startedAt,
        executionIndex,
      }).state

  await writeThreadSurfaceState(basePath, withThreadSurfaceStateRevision(currentState, nextState))
}

async function finalizeRootRunScopeForCommand(basePath: string, runId: string, success: boolean, runSummary: string) {
  const currentState = await readThreadSurfaceState(basePath)
  const nextState = completeRun(currentState, {
    runId,
    runStatus: success ? 'successful' : 'failed',
    endedAt: new Date().toISOString(),
    runSummary,
  }).state
  await writeThreadSurfaceState(basePath, withThreadSurfaceStateRevision(currentState, nextState))
}

async function createStepRunScope(basePath: string, _sequence: Sequence, step: Step): Promise<{ stepRun: StepRunScope | null }> {
  const currentState = await readThreadSurfaceState(basePath)
  const startedAt = new Date().toISOString()
  const result = beginStepRunIfSurfaceExists(currentState, step, {
    now: startedAt,
    nextRunId: randomUUID(),
    executionIndex: currentState.runs.length + 1,
  })

  if (result.state !== currentState) {
    await writeThreadSurfaceState(basePath, withThreadSurfaceStateRevision(currentState, result.state))
  }

  return { stepRun: result.stepRun }
}

async function finalizeStepRunScope(
  basePath: string,
  step: Step,
  stepRuntime: Awaited<ReturnType<typeof createStepRunScope>>,
  runStatus: 'pending' | 'successful' | 'failed',
  runtimeEvents: RuntimeDelegationEvent[],
) {
  const currentState = await readThreadSurfaceState(basePath)
  const finalized = finalizeStepRunWithRuntimeEvents(currentState, {
    step,
    stepRun: stepRuntime.stepRun,
    runStatus,
    endedAt: new Date().toISOString(),
    runtimeEvents,
    nextRunId: randomUUID,
    nextEventId: randomUUID,
    nextMergeId: randomUUID,
  })

  if (finalized.stepRun != null) {
    await writeThreadSurfaceState(basePath, withThreadSurfaceStateRevision(currentState, finalized.state))
  }

  if (finalized.pendingChildSequences.length > 0) {
    await provisionAllChildSequences(basePath, finalized.pendingChildSequences)
  }
}

/** Output an error via JSON or stderr, then exit */
function exitWithError(errorMsg: string, json: boolean): never {
  if (json) {
    console.log(JSON.stringify({ error: errorMsg, success: false }))
  } else {
    console.error(errorMsg)
  }
  process.exit(1)
}

/** Handle `run step <stepId>` */
async function handleRunStep(
  basePath: string,
  sequence: Sequence,
  mprocsClient: MprocsClient,
  args: string[],
  options: CLIOptions
): Promise<void> {
  const stepId = args[0]
  if (!stepId) return exitWithError('Step ID required: seqctl run step <stepId>', options.json)

  const runId = randomUUID()
  const startedAt = new Date().toISOString()
  await createRootRunScopeForCommand(basePath, sequence.name, runId, startedAt)

  const result = await executeSingleStep(basePath, sequence, stepId, runId, mprocsClient)
  await finalizeRootRunScopeForCommand(basePath, runId, result.success, `step:${stepId}`)

  const mprocsMap = await readMprocsMap(basePath)
  const processIndex = Object.keys(mprocsMap).length
  await updateStepProcess(basePath, stepId, processIndex)

  if (options.json) {
    console.log(JSON.stringify(result))
  } else if (result.success) {
    console.log(`Step '${stepId}' completed successfully`)
    console.log(`Duration: ${result.duration}ms`)
    console.log(`Artifacts: ${result.artifactPath}`)
  } else if (result.status === 'BLOCKED') {
    console.log(`Step '${stepId}' blocked: ${result.error || 'Awaiting approval'}`)
  } else {
    console.error(`Step '${stepId}' failed: ${result.error || 'Unknown error'}`)
  }
}

/** Handle `run runnable` — execute all ready steps */
async function handleRunRunnable(
  basePath: string,
  sequence: Sequence,
  mprocsClient: MprocsClient,
  options: CLIOptions
): Promise<void> {
  const runId = randomUUID()
  const startedAt = new Date().toISOString()
  await createRootRunScopeForCommand(basePath, sequence.name, runId, startedAt)

  const executed: RunStepResult[] = []
  const skipped = new Set<string>()
  const waiting = new Set<string>()
  const alreadyExecuted = new Set<string>()

  while (true) {
    const latestSequence = await readSequence(basePath)
    const { steps: latestRunnableSteps, skippedIds: latestSkippedIds } = await getRunnableSteps(basePath, latestSequence)
    for (const skippedStepId of latestSkippedIds) {
      if (!alreadyExecuted.has(skippedStepId)) {
        skipped.add(skippedStepId)
      }
    }
    const runnableSteps = latestRunnableSteps.filter(step => !alreadyExecuted.has(step.id))

    if (runnableSteps.length === 0) break

    const order = topologicalSort(latestSequence)
    const orderedRunnable = order.filter(id => runnableSteps.some(s => s.id === id))

    for (const stepId of orderedRunnable) {
      const currentSequence = await readSequence(basePath)
      const stepResult = await executeSingleStep(basePath, currentSequence, stepId, runId, mprocsClient)
      executed.push(stepResult)
      alreadyExecuted.add(stepId)

      if (!stepResult.success) {
        const downstreamSteps = collectDownstreamDependents(currentSequence, stepId)
        const targetCollection = stepResult.status === 'BLOCKED' ? waiting : skipped
        for (const dependentStepId of downstreamSteps) {
          if (!alreadyExecuted.has(dependentStepId)) {
            targetCollection.add(dependentStepId)
          }
        }
        if (stepResult.abortWorkflow) break
      }
    }

    if (executed.some(result => result.abortWorkflow)) break
  }

  const result: RunRunnableResult = executed.length === 0 && skipped.size === 0 && waiting.size === 0
    ? { success: true, executed, skipped: Array.from(skipped), waiting: Array.from(waiting), error: 'No runnable steps found' }
    : { success: executed.every(e => e.success), executed, skipped: Array.from(skipped), waiting: Array.from(waiting) }
  await finalizeRootRunScopeForCommand(basePath, runId, result.success, 'mode:runnable')
  outputRunnableResult(result, options)
}

function collectDownstreamDependents(
  sequence: Sequence,
  failedStepId: string,
  scopeStepIds?: Set<string>
): string[] {
  const discovered: string[] = []
  const visited = new Set<string>()
  const queue = [failedStepId]

  while (queue.length > 0) {
    const currentStepId = queue.shift()
    if (!currentStepId) continue

    const dependentSteps = sequence.steps.filter(step =>
      step.depends_on.includes(currentStepId)
      && (scopeStepIds == null || scopeStepIds.has(step.id))
    )

    for (const dependentStep of dependentSteps) {
      if (visited.has(dependentStep.id)) continue
      visited.add(dependentStep.id)
      discovered.push(dependentStep.id)
      queue.push(dependentStep.id)
    }
  }

  return discovered
}

function outputRunnableResult(result: RunRunnableResult, options: CLIOptions): void {
  if (options.json) {
    console.log(JSON.stringify(result))
    return
  }
  if (result.executed.length === 0 && result.error) {
    console.log(result.error)
    return
  }
  console.log(`Executed ${result.executed.length} step(s)`)
  for (const e of result.executed) {
    const humanStatus = e.status === 'BLOCKED'
      ? 'BLOCKED'
      : e.success
        ? 'DONE'
        : 'FAILED'
    console.log(`  ${e.stepId}: ${humanStatus} (${e.duration}ms)`)
  }
  if (result.skipped.length > 0) {
    console.log(`Skipped ${result.skipped.length} step(s) due to failures:`)
    for (const s of result.skipped) { console.log(`  ${s}`) }
  }
  if (result.waiting.length > 0) {
    console.log(`Waiting ${result.waiting.length} step(s) on blocked dependencies:`)
    for (const s of result.waiting) { console.log(`  ${s}`) }
  }
}

/** Handle `run group <groupId>` */
async function handleRunGroup(
  basePath: string,
  sequence: Sequence,
  mprocsClient: MprocsClient,
  args: string[],
  options: CLIOptions
): Promise<void> {
  const groupId = args[0]
  if (!groupId) return exitWithError('Group ID required: seqctl run group <groupId>', options.json)

  const groupSteps = sequence.steps.filter(s => s.group_id === groupId)
  if (groupSteps.length === 0) return exitWithError(`No steps found in group '${groupId}'`, options.json)

  const runId = randomUUID()
  const startedAt = new Date().toISOString()
  await createRootRunScopeForCommand(basePath, sequence.name, runId, startedAt)

  const executed: RunStepResult[] = []
  const skipped = new Set<string>()
  const waiting = new Set<string>()
  const groupStepIds = new Set(groupSteps.map(step => step.id))

  const { steps: runnableGroupCandidates, skippedIds: skippedGroupCandidates } = await getRunnableSteps(basePath, sequence)
  for (const skippedStepId of skippedGroupCandidates) {
    if (groupStepIds.has(skippedStepId)) {
      skipped.add(skippedStepId)
    }
  }
  const runnableInGroup = runnableGroupCandidates.filter(step => groupStepIds.has(step.id))

  for (const step of runnableInGroup) {
    const stepResult = await executeSingleStep(basePath, sequence, step.id, runId, mprocsClient)
    executed.push(stepResult)

    if (!stepResult.success) {
      const downstreamSteps = collectDownstreamDependents(sequence, step.id, groupStepIds)
      const targetCollection = stepResult.status === 'BLOCKED' ? waiting : skipped
      for (const dependentStepId of downstreamSteps) {
        targetCollection.add(dependentStepId)
      }
    }
  }

  const result: RunRunnableResult = {
    success: executed.every(e => e.success),
    executed,
    skipped: Array.from(skipped),
    waiting: Array.from(waiting),
  }
  await finalizeRootRunScopeForCommand(basePath, runId, result.success, `group:${groupId}`)

  if (options.json) {
    console.log(JSON.stringify(result))
  } else {
    console.log(`Executed ${executed.length} step(s) from group '${groupId}'`)
    for (const e of executed) {
      const humanStatus = e.status === 'BLOCKED'
        ? 'BLOCKED'
        : e.success
          ? 'DONE'
          : 'FAILED'
      console.log(`  ${e.stepId}: ${humanStatus} (${e.duration}ms)`)
    }
    if (result.skipped.length > 0) {
      console.log(`Skipped ${result.skipped.length} step(s) due to failures:`)
      for (const stepId of result.skipped) { console.log(`  ${stepId}`) }
    }
    if (result.waiting.length > 0) {
      console.log(`Waiting ${result.waiting.length} step(s) on blocked dependencies:`)
      for (const stepId of result.waiting) { console.log(`  ${stepId}`) }
    }
  }
}

type RunSubcommandHandler = (
  basePath: string,
  sequence: Sequence,
  mprocsClient: MprocsClient,
  args: string[],
  options: CLIOptions
) => Promise<void>

const runSubcommands: Record<string, RunSubcommandHandler> = {
  step: handleRunStep,
  runnable: (basePath, sequence, mprocsClient, _args, options) =>
    handleRunRunnable(basePath, sequence, mprocsClient, options),
  group: handleRunGroup,
}

/**
 * Run command handler
 */
export async function runCommand(
  subcommand: string | undefined,
  args: string[],
  options: CLIOptions
): Promise<void> {
  const basePath = options.basePath ?? process.cwd()
  const sequence = await readSequence(basePath)
  validateDAG(sequence)
  const mprocsClient = new MprocsClient()

  const handler = subcommand ? runSubcommands[subcommand] : undefined
  if (!handler) {
    return exitWithError('Unknown subcommand. Usage: seqctl run step|runnable|group', options.json)
  }

  await handler(basePath, sequence, mprocsClient, args, options)
}

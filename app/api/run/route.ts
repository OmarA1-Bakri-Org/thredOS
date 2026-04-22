import { createHash, randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  auditLog,
  checkPolicy,
  handleError,
  jsonError,
  requireRequestSession,
  type PolicyCheckResult,
} from '@/lib/api-helpers'
import { hasApprovedApproval, readApprovals } from '@/lib/approvals/repository'
import { interpolateApprovalNote, recordApprovedApprovalLifecycle, recordPendingApprovalRequest } from '@/lib/approvals/runtime'
import { getBasePath } from '@/lib/config'
import { appendGateDecision } from '@/lib/gates/repository'
import { evaluateStepCompletionGates, evaluateStepGates, getBlockReasons, isStepRunnable } from '@/lib/gates/engine'
import { allowShellModel } from '@/lib/hosted'
import { PolicyEngine } from '@/lib/policy/engine'
import type { PolicyConfig } from '@/lib/policy/schema'
import {
  makeStepInputManifest,
  prepareStepPromptForDispatch,
  resolveStepPromptPath,
  validateStepPromptExists,
} from '@/lib/runner/step-preparation'
import { applyRateLimit } from '@/lib/rate-limit'
import {
  getRuntimeEventLogPath,
  saveRunArtifacts,
  writeCompiledPrompt,
  writeInputManifest,
  writeRunRecord,
  type RunRecordJson,
} from '@/lib/runner/artifacts'
import { assessCompletionResult, dispatch } from '@/lib/runner/dispatch'
import { runStep, type RunnerConfig } from '@/lib/runner/wrapper'
import { topologicalSort, validateDAG } from '@/lib/sequence/dag'
import { readSequence, writeSequence } from '@/lib/sequence/parser'
import type { Sequence, Step } from '@/lib/sequence/schema'
import { ROOT_THREAD_SURFACE_ID } from '@/lib/thread-surfaces/constants'
import { completeRun, createReplacementRun, createRootThreadSurfaceRun } from '@/lib/thread-surfaces/mutations'
import { provisionAllChildSequences } from '@/lib/thread-surfaces/provision-child-sequence'
import { readThreadSurfaceState, withThreadSurfaceStateRevision, writeThreadSurfaceState } from '@/lib/thread-surfaces/repository'
import { readRuntimeEventLog, type RuntimeDelegationEvent } from '@/lib/thread-surfaces/runtime-event-log'
import {
  beginStepRunIfSurfaceExists,
  finalizeStepRunWithRuntimeEvents,
  type StepRunScope,
} from '@/lib/thread-surfaces/step-run-runtime'
import { appendTraceEvent } from '@/lib/traces/writer'
import {
  buildConditionContext,
  evaluateRuntimeCondition,
  evaluateSequenceCondition,
  readRuntimeContext,
} from '@/lib/runtime/context'
import {
  AbortWorkflowError,
  assessSelectedStepEvidence,
  executeNativeOperationalAction,
} from '@/lib/runtime/native-actions'

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000
const THREADOS_EVENT_EMITTER_COMMAND = 'thread event'

const BodySchema = z.union([
  z.object({ stepId: z.string() }),
  z.object({ mode: z.literal('runnable') }),
  z.object({ groupId: z.string() }),
]).and(z.object({ confirmPolicy: z.boolean().optional() }))

type RunRequestBody = z.infer<typeof BodySchema>

interface RunRouteRuntime {
  dispatch: typeof dispatch
  runStep: typeof runStep
  saveRunArtifacts: typeof saveRunArtifacts
  runComposioTool?: (input: {
    toolSlug: string
    arguments: Record<string, unknown>
    timeoutMs?: number
  }) => Promise<unknown>
}

interface ExecuteStepOptions {
  confirmPolicy: boolean
  policyConfig: PolicyConfig
  approvalTargetRef: string
}

type ExecuteStepResult = {
  success: boolean
  stepId: string
  runId: string
  status: 'DONE' | 'FAILED' | 'NEEDS_REVIEW' | 'READY' | 'RUNNING' | 'BLOCKED' | 'SKIPPED'
  error?: string
  duration?: number
  artifactPath?: string
  confirmationRequired?: boolean
  gateReasons?: string[]
  abortWorkflow?: boolean
}

type BatchExecuteResult = {
  success: boolean
  executed: ExecuteStepResult[]
  skipped: string[]
  waiting: string[]
}

interface RunnableStepSelection {
  steps: Step[]
  skippedIds: string[]
}

interface ResolvedTargetSteps {
  steps: Step[]
  skippedIds: string[]
}

class ApprovalRequiredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ApprovalRequiredError'
  }
}

type RunScopeStatus = 'pending' | 'successful' | 'failed'

declare global {
  var __THREADOS_RUN_ROUTE_RUNTIME__: RunRouteRuntime | undefined
}

function getRunRouteRuntime(): RunRouteRuntime {
  return globalThis.__THREADOS_RUN_ROUTE_RUNTIME__ ?? {
    dispatch,
    runStep,
    saveRunArtifacts,
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

async function collectApprovalTargetRefs(
  basePath: string,
  sequence: Sequence,
  step: Step,
  actions: Array<Record<string, unknown>> = (step.actions ?? []) as Array<Record<string, unknown>>,
): Promise<string[]> {
  const targets: string[] = []

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
      targets.push(...await collectApprovalTargetRefs(basePath, sequence, step, nestedActions))
      continue
    }

    if (action.type !== 'approval') continue
    const config = (action.config ?? {}) as Record<string, unknown>
    targets.push(
      typeof config.target_ref === 'string' && config.target_ref.length > 0
        ? config.target_ref
        : `step:${step.id}`,
    )
  }

  return targets
}

async function hasSatisfiedApprovalRequirements(basePath: string, sequence: Sequence, step: Step): Promise<boolean> {
  const targets = await collectApprovalTargetRefs(basePath, sequence, step)
  if (targets.length === 0) return false

  for (const targetRef of targets) {
    if (!await hasApprovedApproval(basePath, targetRef, 'run')) {
      return false
    }
  }

  return true
}

function getCompletedNodeIds(sequence: Sequence): Set<string> {
  return new Set([
    ...sequence.steps.filter(step => step.status === 'DONE' || step.status === 'SKIPPED').map(step => step.id),
    ...sequence.gates.filter(gate => gate.status === 'APPROVED').map(gate => gate.id),
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
      if (!step.depends_on.every(dep => completedNodes.has(dep))) continue

      const conditionSatisfied = await evaluateSequenceCondition(basePath, sequence, (step as Step & { condition?: string }).condition)
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

async function getRunnableSteps(basePath: string, sequence: Sequence): Promise<RunnableStepSelection> {
  const skippedIds = await reconcileSkippedSteps(basePath, sequence)
  const done = getCompletedNodeIds(sequence)

  const steps = (await Promise.all(sequence.steps.map(async step => {
    const isReady = step.status === 'READY'
    const isReopenableBlocked = step.status === 'BLOCKED' && await hasSatisfiedApprovalRequirements(basePath, sequence, step)
    if (!isReady && !isReopenableBlocked) return null
    if (!step.depends_on.every(dep => done.has(dep))) return null
    const conditionSatisfied = await evaluateSequenceCondition(basePath, sequence, (step as Step & { condition?: string }).condition)
    return conditionSatisfied ? step : null
  }))).filter((step): step is Step => step != null)

  return { steps, skippedIds }
}

async function resolveTargetSteps(basePath: string, sequence: Sequence, body: RunRequestBody): Promise<ResolvedTargetSteps> {
  if ('stepId' in body) {
    const step = sequence.steps.find(candidate => candidate.id === body.stepId)
    return { steps: step ? [step] : [], skippedIds: [] }
  }

  if ('groupId' in body) {
    const selection = await getRunnableSteps(basePath, sequence)
    return {
      steps: selection.steps.filter(step => step.group_id === body.groupId),
      skippedIds: selection.skippedIds,
    }
  }

  const selection = await getRunnableSteps(basePath, sequence)
  const runnableById = new Map(selection.steps.map(step => [step.id, step]))
  return {
    steps: topologicalSort(sequence)
      .map(stepId => runnableById.get(stepId) ?? null)
      .filter((step): step is Step => step != null),
    skippedIds: selection.skippedIds,
  }
}

function policyStatusToHttp(result: PolicyCheckResult): { code: string; status: number } {
  return result.confirmationRequired
    ? { code: 'POLICY_CONFIRMATION_REQUIRED', status: 409 }
    : { code: 'POLICY_DENIED', status: 403 }
}

function targetRefFromRunBody(body: RunRequestBody): string {
  if ('stepId' in body) return `step:${body.stepId}`
  if ('groupId' in body) return `group:${body.groupId}`
  return 'mode:runnable'
}

function commandLineFromRunnerConfig(runnerConfig: RunnerConfig): string {
  return [runnerConfig.command, ...(runnerConfig.args ?? [])].join(' ').trim()
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function getSurfaceId(step: Step): string {
  return step.surface_ref || `thread-${step.id}`
}

function getInputManifestRef(runId: string, surfaceId: string): string {
  return `.threados/runs/${runId}/surfaces/${surfaceId}/input.manifest.json`
}

function getArtifactManifestRef(runId: string, surfaceId: string): string {
  return `.threados/runs/${runId}/surfaces/${surfaceId}/artifact.manifest.json`
}

async function executeNativeStepActions(
  basePath: string,
  sequence: Sequence,
  step: Step,
  runId: string,
  runtime: RunRouteRuntime,
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
      await executeNativeStepActions(basePath, sequence, step, runId, runtime, nestedActions)
      continue
    }

    if (action.type === 'approval') {
      const config = (action.config ?? {}) as Record<string, unknown>
      const targetRef = typeof config.target_ref === 'string' && config.target_ref.length > 0
        ? config.target_ref
        : `step:${step.id}`
      const runtimeContext = await readRuntimeContext(basePath)
      const notes = await interpolateApprovalNote(
        basePath,
        typeof config.approval_prompt === 'string' && config.approval_prompt.length > 0
          ? config.approval_prompt
          : typeof action.description === 'string' && action.description.length > 0
            ? action.description
            : null,
        runtimeContext,
      )

      if (step.status === 'BLOCKED' && await hasApprovedApproval(basePath, targetRef, 'run')) {
        continue
      }

      await recordPendingApprovalRequest({
        basePath,
        runId,
        actionType: 'run',
        targetRef,
        requestedBy: 'api:run',
        actor: 'api:run',
        notes,
      })

      throw new ApprovalRequiredError(
        `Awaiting approval for step '${step.id}' via action '${String(action.id ?? 'approval')}'`
      )
    }

    await executeNativeOperationalAction(basePath, sequence, step, runId, {
      ...runtime,
      runComposioTool: runtime.runComposioTool ?? executeComposioTool,
    }, action)
  }
}

function collectDownstreamDependents(
  sequence: Sequence,
  failedStepId: string,
  scopeStepIds?: Set<string>,
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

async function persistGateDecisions(
  basePath: string,
  runId: string,
  surfaceId: string,
  decisions: ReturnType<typeof evaluateStepGates> | ReturnType<typeof evaluateStepCompletionGates>,
  policyRef: string,
) {
  for (const decision of decisions) {
    await appendGateDecision(basePath, runId, decision)
    await appendTraceEvent(basePath, runId, {
      ts: decision.decided_at,
      run_id: runId,
      surface_id: surfaceId,
      actor: 'api:run',
      event_type: decision.status === 'PASS' ? 'gate-evaluated' : 'gate-blocked',
      payload_ref: decision.id,
      policy_ref: policyRef,
    })
  }
}

async function buildRunRecord(basePath: string, params: {
  sequence: Sequence
  step: Step
  runId: string
  surfaceId: string
  policyConfig: PolicyConfig
  compiledPrompt: string
  startedAt: string
  status: RunRecordJson['status']
  attempt: number
  inputManifestRef: string | null
  artifactManifestRef: string | null
  durationMs?: number
}) {
  const {
    sequence,
    step,
    runId,
    surfaceId,
    policyConfig,
    compiledPrompt,
    startedAt,
    status,
    attempt,
    inputManifestRef,
    artifactManifestRef,
    durationMs,
  } = params

  await writeRunRecord(basePath, {
    id: runId,
    sequence_id: sequence.id ?? sequence.name,
    step_id: step.id,
    surface_id: surfaceId,
    attempt,
    status,
    executor: 'threados',
    model: step.model,
    policy_snapshot_hash: sha256(JSON.stringify(policyConfig)),
    compiled_prompt_hash: sha256(compiledPrompt),
    input_manifest_ref: inputManifestRef,
    artifact_manifest_ref: artifactManifestRef,
    started_at: startedAt,
    ended_at: status === 'running' ? null : new Date().toISOString(),
    timing_summary: durationMs == null ? null : { duration_ms: durationMs },
    cost_summary: null,
  })
}

async function enforceBatchPolicy(basePath: string, stepCount: number, confirmed: boolean) {
  const fanoutPolicy = await checkPolicy('fanout', { fanoutCount: stepCount })
  if (!fanoutPolicy.allowed) return fanoutPolicy

  const concurrentPolicy = await checkPolicy('concurrent', { concurrentCount: 1 })
  if (!concurrentPolicy.allowed) return concurrentPolicy

  return checkPolicy('run_command', {
    command: stepCount > 1 ? `threados batch run (${stepCount} steps)` : 'threados run',
    cwd: basePath,
    confirmed,
  })
}

async function createRunScopeForRequest(basePath: string, sequenceName: string, runId: string, startedAt: string) {
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

async function createStepRunScope(basePath: string, step: Step): Promise<{ stepRun: StepRunScope | null }> {
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
  runStatus: RunScopeStatus,
  runtimeEvents: RuntimeDelegationEvent[],
) {
  const currentState = await readThreadSurfaceState(basePath)
  const finalized = finalizeStepRunWithRuntimeEvents(currentState, {
    step,
    stepRun: stepRuntime.stepRun,
    runStatus,
    endedAt: runStatus === 'pending' ? null : new Date().toISOString(),
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

async function finalizeRunScope(basePath: string, runId: string, runStatus: RunScopeStatus, runSummary: string) {
  const currentState = await readThreadSurfaceState(basePath)
  const nextState = completeRun(currentState, {
    runId,
    runStatus,
    endedAt: runStatus === 'pending' ? null : new Date().toISOString(),
    runSummary,
  }).state
  await writeThreadSurfaceState(basePath, withThreadSurfaceStateRevision(currentState, nextState))
}

async function executeStep(
  basePath: string,
  sequence: Sequence,
  stepId: string,
  runId: string,
  options: ExecuteStepOptions,
): Promise<ExecuteStepResult> {
  const step = sequence.steps.find(candidate => candidate.id === stepId)
  if (!step) {
    return { success: false, stepId, runId, status: 'FAILED', error: 'Step not found' }
  }

  const stepRuntime = await createStepRunScope(basePath, step)
  const promptPath = resolveStepPromptPath(basePath, step)
  const promptExists = await validateStepPromptExists(basePath, step)

  if (!promptExists) {
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

  const runtime = getRunRouteRuntime()
  const surfaceId = getSurfaceId(step)
  const startedAt = stepRuntime.stepRun?.startedAt ?? new Date().toISOString()
  const attempt = stepRuntime.stepRun?.executionIndex ?? 1
  const inputManifest = makeStepInputManifest(step, runId, surfaceId, startedAt)
  const inputManifestRef = getInputManifestRef(runId, surfaceId)
  const artifactManifestRef = getArtifactManifestRef(runId, surfaceId)

  try {
    const runtimeEventLogPath = getRuntimeEventLogPath(basePath, runId, stepId)
    const preparedPrompt = await prepareStepPromptForDispatch({
      stepId,
      step,
      sequence,
      basePath,
      maxTokens: step.model === 'claude-code' ? 8000 : 4000,
      runtimeEventLogPath,
      runtimeEventEmitterCommand: THREADOS_EVENT_EMITTER_COMMAND,
    })

    await writeInputManifest(basePath, runId, surfaceId, inputManifest)
    await writeCompiledPrompt(basePath, runId, surfaceId, preparedPrompt.promptForDispatch)

    const approvals = await readApprovals(basePath, runId).catch(() => [])
    const approvalPresent = options.confirmPolicy
      || (step.status === 'BLOCKED' && await hasApprovedApproval(basePath, `step:${step.id}`, 'run'))
      || (step.status === 'BLOCKED' && await hasApprovedApproval(basePath, options.approvalTargetRef, 'run'))
      || approvals.some(approval => approval.status === 'approved' && (
        approval.target_ref === `step:${step.id}` || approval.target_ref === options.approvalTargetRef
      ))

    const currentSurfaceState = await readThreadSurfaceState(basePath)
    const surface = currentSurfaceState.threadSurfaces.find(candidate => candidate.id === surfaceId)
    const preRunDecisions = evaluateStepGates(step, sequence.steps, sequence.gates, {
      policyMode: options.policyConfig.mode,
      sideEffectMode: options.policyConfig.side_effect_mode,
      crossSurfaceReads: options.policyConfig.cross_surface_reads,
      surfaceClass: surface?.surfaceClass ?? 'shared',
      revealState: surface?.surfaceClass === 'sealed' ? 'revealed' : (surface?.revealState ?? null),
      isDependency: true,
      inputManifestPresent: true,
      approvalPresent,
    })

    await persistGateDecisions(basePath, runId, surfaceId, preRunDecisions, options.policyConfig.mode)

    if (!isStepRunnable(preRunDecisions)) {
      const gateReasons = getBlockReasons(preRunDecisions)
      await buildRunRecord(basePath, {
        sequence,
        step,
        runId,
        surfaceId,
        policyConfig: options.policyConfig,
        compiledPrompt: preparedPrompt.promptForDispatch,
        startedAt,
        status: 'failed',
        attempt,
        inputManifestRef,
        artifactManifestRef: null,
      })
      await finalizeStepRunScope(basePath, step, stepRuntime, 'failed', []).catch(() => {})
      return {
        success: false,
        stepId,
        runId,
        status: 'READY',
        error: gateReasons.join(', '),
        confirmationRequired: preRunDecisions.some(decision => decision.status === 'NEEDS_APPROVAL'),
        gateReasons,
      }
    }

    if (step.model === 'shell' && !allowShellModel()) {
      await buildRunRecord(basePath, {
        sequence,
        step,
        runId,
        surfaceId,
        policyConfig: options.policyConfig,
        compiledPrompt: preparedPrompt.promptForDispatch,
        startedAt,
        status: 'failed',
        attempt,
        inputManifestRef,
        artifactManifestRef: null,
      })
      await finalizeStepRunScope(basePath, step, stepRuntime, 'failed', []).catch(() => {})
      return {
        success: false,
        stepId,
        runId,
        status: step.status,
        error: 'Shell execution is disabled in hosted mode',
      }
    }

    await executeNativeStepActions(basePath, sequence, step, runId, runtime)

    const runnerConfig = await runtime.dispatch(step.model, {
      stepId,
      runId,
      compiledPrompt: preparedPrompt.promptForDispatch,
      cwd: step.cwd || basePath,
      timeout: step.timeout_ms || DEFAULT_TIMEOUT_MS,
      runtimeEventLogPath,
      runtimeEventEmitterCommand: THREADOS_EVENT_EMITTER_COMMAND,
    })

    const policyResult = await checkPolicy('run_command', {
      command: commandLineFromRunnerConfig(runnerConfig),
      cwd: runnerConfig.cwd,
      confirmed: options.confirmPolicy,
    })
    if (!policyResult.allowed) {
      await buildRunRecord(basePath, {
        sequence,
        step,
        runId,
        surfaceId,
        policyConfig: options.policyConfig,
        compiledPrompt: preparedPrompt.promptForDispatch,
        startedAt,
        status: 'failed',
        attempt,
        inputManifestRef,
        artifactManifestRef: null,
      })
      await finalizeStepRunScope(basePath, step, stepRuntime, 'failed', []).catch(() => {})
      return {
        success: false,
        stepId,
        runId,
        status: step.status,
        error: policyResult.reason ?? 'Policy denied',
        confirmationRequired: policyResult.confirmationRequired,
      }
    }

    await buildRunRecord(basePath, {
      sequence,
      step,
      runId,
      surfaceId,
      policyConfig: options.policyConfig,
      compiledPrompt: preparedPrompt.promptForDispatch,
      startedAt,
      status: 'running',
      attempt,
      inputManifestRef,
      artifactManifestRef: null,
    })

    step.status = 'RUNNING'
    await writeSequence(basePath, sequence)

    const result = await runtime.runStep(runnerConfig)
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
    await persistGateDecisions(basePath, runId, surfaceId, completionDecisions, options.policyConfig.mode)

    const completionPassed = isStepRunnable(completionDecisions)
    step.status = completionAssessment.status
    if (step.status === 'DONE' && !completionPassed) {
      step.status = 'NEEDS_REVIEW'
    }
    await writeSequence(basePath, sequence)
    await buildRunRecord(basePath, {
      sequence,
      step,
      runId,
      surfaceId,
      policyConfig: options.policyConfig,
      compiledPrompt: preparedPrompt.promptForDispatch,
      startedAt,
      status: step.status === 'DONE' ? 'successful' : 'failed',
      attempt,
      inputManifestRef,
      artifactManifestRef,
      durationMs: result.duration,
    })
    await finalizeStepRunScope(basePath, step, stepRuntime, step.status === 'DONE' ? 'successful' : 'failed', runtimeEvents.events)
    return {
      success: step.status === 'DONE',
      stepId,
      runId,
      status: step.status,
      duration: result.duration,
      artifactPath,
      gateReasons: completionPassed ? completionAssessment.reasons : [...completionAssessment.reasons, ...getBlockReasons(completionDecisions)],
    }
  } catch (error) {
    step.status = error instanceof ApprovalRequiredError ? 'BLOCKED' : 'FAILED'
    await writeSequence(basePath, sequence).catch(() => {})
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

async function executeBatchSteps(
  basePath: string,
  sequence: Sequence,
  targetSteps: Step[],
  runId: string,
  options: ExecuteStepOptions,
  scopeStepIds?: Set<string>,
  expandRunnableFrontier = false,
  initialSkippedIds: string[] = [],
): Promise<BatchExecuteResult> {
  const executed: ExecuteStepResult[] = []
  const skipped = new Set<string>(initialSkippedIds)
  const waiting = new Set<string>()
  const alreadyExecuted = new Set<string>()

  while (true) {
    const currentSequence = expandRunnableFrontier ? await readSequence(basePath) : sequence
    const currentSelection = await getRunnableSteps(basePath, currentSequence)
    for (const skippedStepId of currentSelection.skippedIds) {
      if (scopeStepIds == null || scopeStepIds.has(skippedStepId)) {
        skipped.add(skippedStepId)
      }
    }

    const currentTargetSteps = expandRunnableFrontier
      ? currentSelection.steps.filter(step => !alreadyExecuted.has(step.id))
      : targetSteps.filter(step => !alreadyExecuted.has(step.id) && currentSelection.steps.some(candidate => candidate.id === step.id))

    if (currentTargetSteps.length === 0) break

    const currentTargetIds = new Set(currentTargetSteps.map(step => step.id))
    const orderedStepIds = topologicalSort(currentSequence).filter(stepId => currentTargetIds.has(stepId))

    for (const stepId of orderedStepIds) {
      const result = await executeStep(basePath, currentSequence, stepId, runId, options)
      executed.push(result)
      alreadyExecuted.add(stepId)

      if (!result.success) {
        const downstreamSteps = collectDownstreamDependents(currentSequence, stepId, scopeStepIds)
        const targetCollection = result.status === 'BLOCKED' ? waiting : skipped
        for (const dependentStepId of downstreamSteps) {
          if (!alreadyExecuted.has(dependentStepId)) {
            targetCollection.add(dependentStepId)
          }
        }
        if (result.abortWorkflow) break
      }
    }

    if (executed.some(result => result.abortWorkflow)) break
    if (!expandRunnableFrontier) break
  }

  return {
    success: executed.every(result => result.success),
    executed,
    skipped: Array.from(skipped),
    waiting: Array.from(waiting),
  }
}

export async function POST(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session

    const rateLimited = applyRateLimit(request, {
      bucket: 'run',
      limit: 30,
      windowMs: 5 * 60 * 1000,
    })
    if (rateLimited) return rateLimited

    const body = BodySchema.parse(await request.json())
    const basePath = getBasePath()
    const sequence = await readSequence(basePath)
    validateDAG(sequence)

    const { steps: targetSteps, skippedIds: targetSkippedIds } = await resolveTargetSteps(basePath, sequence, body)
    const batchPolicy = await enforceBatchPolicy(basePath, targetSteps.length, body.confirmPolicy === true)
    if (!batchPolicy.allowed) {
      const policyHttp = policyStatusToHttp(batchPolicy)
      return jsonError(batchPolicy.reason ?? 'Policy denied', policyHttp.code, policyHttp.status)
    }

    if (targetSteps.length === 0) {
      if ('stepId' in body) {
        return jsonError(`Step '${body.stepId}' not found`, 'NOT_FOUND', 404)
      }
      return NextResponse.json({ success: true, executed: [], skipped: targetSkippedIds, waiting: [] })
    }

    const runId = randomUUID()
    const startedAt = new Date().toISOString()
    await createRunScopeForRequest(basePath, sequence.name, runId, startedAt)

    const policyEngine = await PolicyEngine.load(basePath)
    const policyConfig = policyEngine.getConfig()
    const approvalTargetRef = targetRefFromRunBody(body)
    if (body.confirmPolicy === true && policyConfig.mode === 'SAFE') {
      await recordApprovedApprovalLifecycle({
        basePath,
        runId,
        actionType: 'run',
        targetRef: approvalTargetRef,
        requestedBy: session.email,
        resolvedBy: session.email,
        actor: 'api:run',
        notes: 'SAFE mode confirmation acknowledged before dispatch.',
        policyRef: 'SAFE',
      })
    }

    if ('stepId' in body) {
      const result = await executeStep(basePath, sequence, body.stepId, runId, {
        confirmPolicy: body.confirmPolicy === true,
        policyConfig,
        approvalTargetRef,
      })
      await finalizeRunScope(basePath, runId, result.success ? 'successful' : 'failed', `step:${body.stepId}`)
      await auditLog('run.step', body.stepId, { runId }, result.success ? 'ok' : 'failed')
      if (!result.success && result.confirmationRequired) {
        return jsonError(result.error ?? 'Policy confirmation required', 'POLICY_CONFIRMATION_REQUIRED', 409)
      }
      return NextResponse.json(result)
    }

    if ('groupId' in body) {
      const groupStepIds = new Set<string>(sequence.steps.filter(step => step.group_id === body.groupId).map(step => step.id))
      const result = await executeBatchSteps(basePath, sequence, targetSteps, runId, {
        confirmPolicy: body.confirmPolicy === true,
        policyConfig,
        approvalTargetRef,
      }, groupStepIds, false, targetSkippedIds)
      await finalizeRunScope(basePath, runId, result.success ? 'successful' : 'failed', `group:${body.groupId}`)
      await auditLog('run.group', body.groupId, { runId, count: result.executed.length }, result.success ? 'ok' : 'failed')
      return NextResponse.json(result)
    }

    const result = await executeBatchSteps(basePath, sequence, targetSteps, runId, {
      confirmPolicy: body.confirmPolicy === true,
      policyConfig,
      approvalTargetRef,
    }, undefined, true, targetSkippedIds)
    await finalizeRunScope(basePath, runId, result.success ? 'successful' : 'failed', 'mode:runnable')
    await auditLog('run.runnable', '*', { runId, count: result.executed.length }, result.success ? 'ok' : 'failed')
    return NextResponse.json(result)
  } catch (error) {
    return handleError(error)
  }
}

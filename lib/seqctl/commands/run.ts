import { randomUUID } from 'crypto'
import { readSequence, writeSequence } from '../../sequence/parser'
import { validateDAG, topologicalSort } from '../../sequence/dag'
import { MprocsClient } from '../../mprocs/client'
import { updateStepProcess, readMprocsMap } from '../../mprocs/state'
import { runStep } from '../../runner/wrapper'
import { saveRunArtifacts } from '../../runner/artifacts'
import { compilePrompt } from '../../runner/prompt-compiler'
import { dispatch, exitCodeToStatus } from '../../runner/dispatch'
import { readPrompt, validatePromptExists } from '../../prompts/manager'
import { StepNotFoundError } from '../../errors'
import type { Step, Sequence, StepStatus } from '../../sequence/schema'
import { readThreadSurfaceState, writeThreadSurfaceState } from '../../thread-surfaces/repository'
import { completeRun, createChildThreadSurfaceRun, createReplacementRun, createRootThreadSurfaceRun, recordChildAgentSpawnEvent, recordMergeEvent } from '../../thread-surfaces/mutations'
import { deriveMergeEventForSuccessfulStep } from '../../thread-surfaces/merge-runtime'
import { deriveStepThreadSurfaceId } from '../../thread-surfaces/step-runtime'
import { deriveSpawnSpecsForStep, type SpawnSpec } from '../../thread-surfaces/spawn-runtime'
import type { ThreadSurfaceState } from '../../thread-surfaces/repository'

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

interface CLIOptions {
  json: boolean
  help: boolean
  watch: boolean
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
}

interface RunRunnableResult {
  success: boolean
  executed: RunStepResult[]
  skipped: string[]
  error?: string
}

interface CLIRunRuntime {
  dispatch: typeof dispatch
  runStep: typeof runStep
  saveRunArtifacts: typeof saveRunArtifacts
}

declare global {
  var __THREADOS_CLI_RUN_RUNTIME__: CLIRunRuntime | undefined
}

const ROOT_THREAD_SURFACE_ID = 'thread-root'

function getCLIRunRuntime(): CLIRunRuntime {
  return globalThis.__THREADOS_CLI_RUN_RUNTIME__ ?? {
    dispatch,
    runStep,
    saveRunArtifacts,
  }
}

/**
 * Get runnable steps (READY status with all dependencies satisfied)
 */
function getRunnableSteps(sequence: Sequence): Step[] {
  const doneSteps = new Set(
    sequence.steps
      .filter(s => s.status === 'DONE')
      .map(s => s.id)
  )

  // Gates that are approved also count as done
  const approvedGates = new Set(
    sequence.gates
      .filter(g => g.status === 'APPROVED')
      .map(g => g.id)
  )

  const completedNodes = new Set([...doneSteps, ...approvedGates])

  return sequence.steps.filter(step => {
    if (step.status !== 'READY') return false

    // Check all dependencies are satisfied
    return step.depends_on.every(depId => completedNodes.has(depId))
  })
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

  // Validate prompt file exists \u2014 use step.prompt_file, not hardcoded stepId path
  const promptPath = step.prompt_file
  const promptExists = await validatePromptExists(basePath, stepId)
  if (!promptExists) {
    // Bug fix: persist FAILED status so step isn't re-selected by run runnable
    step.status = 'FAILED'
    await writeSequence(basePath, sequence)
    await finalizeStepRunScope(basePath, sequence, step, stepRuntime, false).catch(() => {})
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
    // 1. Read raw prompt
    const rawPrompt = await readPrompt(basePath, stepId)

    // 2. Compile with context (skip for shell \u2014 shell runs raw script directly)
    const promptForDispatch = step.model === 'shell'
      ? rawPrompt
      : await compilePrompt({
          stepId,
          step,
          rawPrompt,
          sequence,
          basePath,
          maxTokens: step.model === 'claude-code' ? 8000 : 4000,
        })

    // 3. Dispatch to agent (writes temp prompt, resolves CLI, checks availability)
    const runnerConfig = await runtime.dispatch(step.model, {
      stepId,
      runId,
      compiledPrompt: promptForDispatch,
      cwd: step.cwd || basePath,
      timeout: step.timeout_ms || DEFAULT_TIMEOUT_MS,
    })

    // 4. Execute via runner
    const result = await runtime.runStep(runnerConfig)

    // 5. Save artifacts
    const artifactPath = await runtime.saveRunArtifacts(basePath, result)

    // 6. Map exit code to step status
    const newStatus = exitCodeToStatus(result.exitCode)
    step.status = newStatus
    await writeSequence(basePath, sequence)
    await finalizeStepRunScope(basePath, sequence, step, stepRuntime, newStatus === 'DONE')

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
    step.status = 'FAILED'
    try {
      await writeSequence(basePath, sequence)
    } catch (writeError) {
      console.error(
        `Failed to persist failed step '${stepId}' for run '${runId}':`,
        writeError
      )
    }
    await finalizeStepRunScope(basePath, sequence, step, stepRuntime, false).catch(() => {})

    return {
      success: false,
      stepId,
      runId,
      status: 'FAILED',
      error: error instanceof Error ? error.message : String(error),
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

  await writeThreadSurfaceState(basePath, nextState)
}

async function finalizeRootRunScopeForCommand(basePath: string, runId: string, success: boolean, runSummary: string) {
  const currentState = await readThreadSurfaceState(basePath)
  const nextState = completeRun(currentState, {
    runId,
    runStatus: success ? 'successful' : 'failed',
    endedAt: new Date().toISOString(),
    runSummary,
  }).state
  await writeThreadSurfaceState(basePath, nextState)
}

interface StepRunScope {
  runId: string
  startedAt: string
  executionIndex: number
  threadSurfaceId: string
}

async function createStepRunScope(basePath: string, sequence: Sequence, step: Step): Promise<{ stepRun: StepRunScope | null; spawnSpecs: SpawnSpec[] }> {
  const currentState = await readThreadSurfaceState(basePath)
  const spawnSpecs = deriveSpawnSpecsForStep({ sequence, step })
  const threadSurfaceId = deriveStepThreadSurfaceId(step.id)
  const existingSurface = currentState.threadSurfaces.find(surface => surface.id === threadSurfaceId) ?? null
  const shouldCreateSurface = existingSurface != null || spawnSpecs.length > 0 || step.watchdog_for != null || step.fusion_synth === true

  if (!shouldCreateSurface) {
    return { stepRun: null, spawnSpecs }
  }

  const childRunId = randomUUID()
  const startedAt = new Date().toISOString()
  const executionIndex = currentState.runs.length + 1
  const nextState = existingSurface
    ? createReplacementRun(currentState, {
        threadSurfaceId,
        runId: childRunId,
        startedAt,
        executionIndex,
      }).state
    : createChildThreadSurfaceRun(currentState, {
        parentSurfaceId: resolveParentSurfaceId(currentState, step),
        parentAgentNodeId: step.id,
        childSurfaceId: threadSurfaceId,
        childSurfaceLabel: step.name,
        createdAt: startedAt,
        runId: childRunId,
        startedAt,
        executionIndex,
      }).state

  await writeThreadSurfaceState(basePath, nextState)

  return {
    stepRun: {
      runId: childRunId,
      startedAt,
      executionIndex,
      threadSurfaceId,
    },
    spawnSpecs,
  }
}

async function finalizeStepRunScope(basePath: string, sequence: Sequence, step: Step, stepRuntime: Awaited<ReturnType<typeof createStepRunScope>>, success: boolean) {
  if (stepRuntime.stepRun == null) {
    return
  }

  const currentState = await readThreadSurfaceState(basePath)
  let nextState = completeRun(currentState, {
    runId: stepRuntime.stepRun.runId,
    runStatus: success ? 'successful' : 'failed',
    endedAt: new Date().toISOString(),
    runSummary: success ? `step:${step.id}` : `step:${step.id}:failed`,
  }).state

  if (success) {
    nextState = persistSpawnedChildren(nextState, stepRuntime.stepRun, stepRuntime.spawnSpecs)

    const mergeEvent = deriveMergeEventForSuccessfulStep({
      step,
      threadSurfaces: nextState.threadSurfaces,
      stepThreadSurfaceIds: Object.fromEntries(sequence.steps.map(sequenceStep => [sequenceStep.id, deriveStepThreadSurfaceId(sequenceStep.id)])),
      runId: stepRuntime.stepRun.runId,
      mergeId: randomUUID(),
      executionIndex: stepRuntime.stepRun.executionIndex,
      createdAt: new Date().toISOString(),
      summary: step.name,
    })

    if (mergeEvent) {
      nextState = recordMergeEvent(nextState, {
        mergeId: mergeEvent.id,
        runId: mergeEvent.runId,
        destinationThreadSurfaceId: mergeEvent.destinationThreadSurfaceId,
        sourceThreadSurfaceIds: mergeEvent.sourceThreadSurfaceIds,
        mergeKind: mergeEvent.mergeKind,
        executionIndex: mergeEvent.executionIndex,
        createdAt: mergeEvent.createdAt,
        summary: mergeEvent.summary,
      }).state
    }
  }

  await writeThreadSurfaceState(basePath, nextState)
}

function persistSpawnedChildren(state: ThreadSurfaceState, stepRun: StepRunScope, spawnSpecs: SpawnSpec[]): ThreadSurfaceState {
  let nextState = state

  for (const spawnSpec of spawnSpecs) {
    const createdAt = new Date().toISOString()
    const childSurfaceExists = nextState.threadSurfaces.some(surface => surface.id === spawnSpec.childThreadSurfaceId)

    if (!childSurfaceExists) {
      nextState = createChildThreadSurfaceRun(nextState, {
        parentSurfaceId: spawnSpec.parentThreadSurfaceId,
        parentAgentNodeId: spawnSpec.childAgentNodeId,
        childSurfaceId: spawnSpec.childThreadSurfaceId,
        childSurfaceLabel: spawnSpec.childSurfaceLabel,
        createdAt,
        runId: randomUUID(),
        startedAt: createdAt,
        executionIndex: nextState.runs.length + 1,
      }).state
    } else if (spawnSpec.childThreadSurfaceId !== stepRun.threadSurfaceId) {
      nextState = createReplacementRun(nextState, {
        threadSurfaceId: spawnSpec.childThreadSurfaceId,
        runId: randomUUID(),
        startedAt: createdAt,
        executionIndex: nextState.runs.length + 1,
      }).state
    }

    nextState = recordChildAgentSpawnEvent(nextState, {
      eventId: randomUUID(),
      runId: stepRun.runId,
      threadSurfaceId: spawnSpec.parentThreadSurfaceId,
      childThreadSurfaceId: spawnSpec.childThreadSurfaceId,
      parentThreadSurfaceId: spawnSpec.parentThreadSurfaceId,
      createdAt,
    }).state
  }

  return nextState
}

function resolveParentSurfaceId(state: ThreadSurfaceState, step: Step): string {
  if (step.watchdog_for) {
    const watchedSurfaceId = deriveStepThreadSurfaceId(step.watchdog_for)
    if (state.threadSurfaces.some(surface => surface.id === watchedSurfaceId)) {
      return watchedSurfaceId
    }
  }

  return ROOT_THREAD_SURFACE_ID
}

/**
 * Run command handler
 */
export async function runCommand(
  subcommand: string | undefined,
  args: string[],
  options: CLIOptions
): Promise<void> {
  const basePath = process.cwd()
  const runId = randomUUID()

  // Read and validate sequence
  const sequence = await readSequence(basePath)
  validateDAG(sequence)
  const startedAt = new Date().toISOString()
  await createRootRunScopeForCommand(basePath, sequence.name, runId, startedAt)

  const mprocsClient = new MprocsClient()

  if (subcommand === 'step') {
    // Run a specific step
    const stepId = args[0]
    if (!stepId) {
      const errorMsg = 'Step ID required: seqctl run step <stepId>'
      if (options.json) {
        console.log(JSON.stringify({ error: errorMsg, success: false }))
      } else {
        console.error(errorMsg)
      }
      process.exit(1)
    }

    const result = await executeSingleStep(
      basePath,
      sequence,
      stepId,
      runId,
      mprocsClient
    )
    await finalizeRootRunScopeForCommand(basePath, runId, result.success, `step:${stepId}`)

    // Update mprocs map
    const mprocsMap = await readMprocsMap(basePath)
    const processIndex = Object.keys(mprocsMap).length
    await updateStepProcess(basePath, stepId, processIndex)

    if (options.json) {
      console.log(JSON.stringify(result))
    } else {
      if (result.success) {
        console.log(`Step '${stepId}' completed successfully`)
        console.log(`Duration: ${result.duration}ms`)
        console.log(`Artifacts: ${result.artifactPath}`)
      } else {
        console.error(`Step '${stepId}' failed: ${result.error || 'Unknown error'}`)
      }
    }
  } else if (subcommand === 'runnable') {
    // Run all runnable steps
    const runnableSteps = getRunnableSteps(sequence)

    if (runnableSteps.length === 0) {
    const result: RunRunnableResult = {
      success: true,
      executed: [],
      skipped: [],
      error: 'No runnable steps found',
      }
      if (options.json) {
        console.log(JSON.stringify(result))
      } else {
        console.log('No runnable steps found')
      }
      return
    }

    // Get topological order and filter to runnable
    const order = topologicalSort(sequence)
    const orderedRunnable = order.filter(id =>
      runnableSteps.some(s => s.id === id)
    )

    const executed: RunStepResult[] = []
    const skipped: string[] = []

    for (const stepId of orderedRunnable) {
      const result = await executeSingleStep(
        basePath,
        sequence,
        stepId,
        runId,
        mprocsClient
      )
      executed.push(result)

      // If a step fails, we might want to skip dependent steps
      if (!result.success) {
        // Find steps that depend on this one and mark them as skipped
        const dependentSteps = sequence.steps.filter(s =>
          s.depends_on.includes(stepId) && orderedRunnable.includes(s.id)
        )
        for (const dep of dependentSteps) {
          if (!executed.some(e => e.stepId === dep.id)) {
            skipped.push(dep.id)
          }
        }
      }
    }

    const result: RunRunnableResult = {
      success: executed.every(e => e.success),
      executed,
      skipped,
    }
    await finalizeRootRunScopeForCommand(basePath, runId, result.success, 'mode:runnable')

    if (options.json) {
      console.log(JSON.stringify(result))
    } else {
      console.log(`Executed ${executed.length} step(s)`)
      for (const e of executed) {
        const status = e.success ? 'DONE' : 'FAILED'
        console.log(`  ${e.stepId}: ${status} (${e.duration}ms)`)
      }
      if (skipped.length > 0) {
        console.log(`Skipped ${skipped.length} step(s) due to failures:`)
        for (const s of skipped) {
          console.log(`  ${s}`)
        }
      }
    }
  } else if (subcommand === 'group') {
    // Run all READY steps in a group
    const groupId = args[0]
    if (!groupId) {
      const errorMsg = 'Group ID required: seqctl run group <groupId>'
      if (options.json) {
        console.log(JSON.stringify({ error: errorMsg, success: false }))
      } else {
        console.error(errorMsg)
      }
      process.exit(1)
    }

    const groupSteps = sequence.steps.filter(s => s.group_id === groupId)
    if (groupSteps.length === 0) {
      const errorMsg = `No steps found in group '${groupId}'`
      if (options.json) {
        console.log(JSON.stringify({ error: errorMsg, success: false }))
      } else {
        console.error(errorMsg)
      }
      process.exit(1)
    }

    const runnableInGroup = groupSteps.filter(s => {
      if (s.status !== 'READY') return false
      const doneSteps = new Set(sequence.steps.filter(st => st.status === 'DONE').map(st => st.id))
      const approvedGates = new Set(sequence.gates.filter(g => g.status === 'APPROVED').map(g => g.id))
      const completed = new Set([...doneSteps, ...approvedGates])
      return s.depends_on.every(dep => completed.has(dep))
    })

    const executed: RunStepResult[] = []
    // Run all in parallel
    const promises = runnableInGroup.map(s =>
      executeSingleStep(basePath, sequence, s.id, runId, mprocsClient)
    )
    const results = await Promise.all(promises)
    executed.push(...results)

    const result: RunRunnableResult = {
      success: executed.every(e => e.success),
      executed,
      skipped: [],
    }
    await finalizeRootRunScopeForCommand(basePath, runId, result.success, `group:${groupId}`)

    if (options.json) {
      console.log(JSON.stringify(result))
    } else {
      console.log(`Executed ${executed.length} step(s) from group '${groupId}'`)
      for (const e of executed) {
        const status = e.success ? 'DONE' : 'FAILED'
        console.log(`  ${e.stepId}: ${status} (${e.duration}ms)`)
      }
    }
  } else {
    const errorMsg = 'Unknown subcommand. Usage: seqctl run step|runnable|group'
    if (options.json) {
      console.log(JSON.stringify({ error: errorMsg, success: false }))
    } else {
      console.error(errorMsg)
    }
    process.exit(1)
  }
}

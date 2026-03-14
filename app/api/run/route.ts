import { NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { readSequence, writeSequence } from '@/lib/sequence/parser'
import { validateDAG, topologicalSort } from '@/lib/sequence/dag'
import { getBasePath } from '@/lib/config'
import { jsonError, auditLog, checkPolicy, handleError } from '@/lib/api-helpers'
import type { Sequence, Step } from '@/lib/sequence/schema'
import { runStep } from '@/lib/runner/wrapper'
import { getRuntimeEventLogPath, saveRunArtifacts } from '@/lib/runner/artifacts'
import { compilePrompt } from '@/lib/runner/prompt-compiler'
import { dispatch, exitCodeToStatus } from '@/lib/runner/dispatch'
import { readPrompt, validatePromptExists } from '@/lib/prompts/manager'
import { readThreadSurfaceState, writeThreadSurfaceState } from '@/lib/thread-surfaces/repository'
import { completeRun, createReplacementRun, createRootThreadSurfaceRun } from '@/lib/thread-surfaces/mutations'
import { beginStepRunIfSurfaceExists, finalizeStepRunWithRuntimeEvents, type StepRunScope } from '@/lib/thread-surfaces/step-run-runtime'
import { ROOT_THREAD_SURFACE_ID } from '@/lib/thread-surfaces/constants'
import { readRuntimeEventLog, type RuntimeDelegationEvent } from '@/lib/thread-surfaces/runtime-event-log'
import { provisionAllChildSequences } from '@/lib/thread-surfaces/provision-child-sequence'

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
const THREADOS_EVENT_EMITTER_COMMAND = 'thread event'

const BodySchema = z.union([
  z.object({ stepId: z.string() }),
  z.object({ mode: z.literal('runnable') }),
  z.object({ groupId: z.string() }),
])

interface RunRouteRuntime {
  dispatch: typeof dispatch
  runStep: typeof runStep
  saveRunArtifacts: typeof saveRunArtifacts
}

declare global {
  var __THREADOS_RUN_ROUTE_RUNTIME__: RunRouteRuntime | undefined
}

function getRunnableSteps(sequence: Sequence): Step[] {
  const done = new Set([
    ...sequence.steps.filter(s => s.status === 'DONE').map(s => s.id),
    ...sequence.gates.filter(g => g.status === 'APPROVED').map(g => g.id),
  ])
  return sequence.steps.filter(s => s.status === 'READY' && s.depends_on.every(d => done.has(d)))
}

async function executeStep(bp: string, seq: Sequence, stepId: string, runId: string) {
  const step = seq.steps.find(s => s.id === stepId)
  if (!step) return { success: false, stepId, runId, status: 'FAILED' as const, error: 'Step not found' }

  const stepRuntime = await createStepRunScope(bp, seq, step)
  const promptPath = step.prompt_file
  const promptExists = await validatePromptExists(bp, stepId)

  if (!promptExists) {
    step.status = 'FAILED'
    await writeSequence(bp, seq)
    await finalizeStepRunScope(bp, step, stepRuntime, false, []).catch(() => {})
    return {
      success: false,
      stepId,
      runId,
      status: 'FAILED' as const,
      error: `Prompt file not found for step '${stepId}'. Expected: ${promptPath}`,
    }
  }

  step.status = 'RUNNING'
  await writeSequence(bp, seq)
  try {
    const runtime = getRunRouteRuntime()
    const runtimeEventLogPath = getRuntimeEventLogPath(bp, runId, stepId)
    const rawPrompt = await readPrompt(bp, stepId)
    const promptForDispatch = step.model === 'shell'
      ? rawPrompt
      : await compilePrompt({
          stepId,
          step,
          rawPrompt,
          sequence: seq,
          basePath: bp,
          maxTokens: step.model === 'claude-code' ? 8000 : 4000,
          runtimeEventLogPath,
          runtimeEventEmitterCommand: THREADOS_EVENT_EMITTER_COMMAND,
        })

    const runnerConfig = await runtime.dispatch(step.model, {
      stepId,
      runId,
      compiledPrompt: promptForDispatch,
      cwd: step.cwd || bp,
      timeout: step.timeout_ms || DEFAULT_TIMEOUT_MS,
      runtimeEventLogPath,
      runtimeEventEmitterCommand: THREADOS_EVENT_EMITTER_COMMAND,
    })
    const result = await runtime.runStep(runnerConfig)
    const artifactPath = await runtime.saveRunArtifacts(bp, result)
    const runtimeEvents = await readRuntimeEventLog(bp, runId, stepId)
    step.status = exitCodeToStatus(result.exitCode)
    await writeSequence(bp, seq)
    await finalizeStepRunScope(bp, step, stepRuntime, step.status === 'DONE', runtimeEvents.events)
    return { success: result.status === 'SUCCESS', stepId, runId, status: step.status, duration: result.duration, artifactPath }
  } catch (err) {
    step.status = 'FAILED'
    await writeSequence(bp, seq).catch(() => {})
    await finalizeStepRunScope(bp, step, stepRuntime, false, []).catch(() => {})
    return { success: false, stepId, runId, status: 'FAILED' as const, error: err instanceof Error ? err.message : String(err) }
  }
}

function getRunRouteRuntime(): RunRouteRuntime {
  return globalThis.__THREADOS_RUN_ROUTE_RUNTIME__ ?? {
    dispatch,
    runStep,
    saveRunArtifacts,
  }
}

async function createRunScopeForRequest(bp: string, sequenceName: string, runId: string, startedAt: string) {
  const currentState = await readThreadSurfaceState(bp)
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

  await writeThreadSurfaceState(bp, nextState)
}

async function createStepRunScope(bp: string, _seq: Sequence, step: Step): Promise<{ stepRun: StepRunScope | null }> {
  const currentState = await readThreadSurfaceState(bp)
  const startedAt = new Date().toISOString()
  const result = beginStepRunIfSurfaceExists(currentState, step, {
    now: startedAt,
    nextRunId: randomUUID(),
    executionIndex: currentState.runs.length + 1,
  })

  if (result.state !== currentState) {
    await writeThreadSurfaceState(bp, result.state)
  }

  return { stepRun: result.stepRun }
}

async function finalizeStepRunScope(
  bp: string,
  step: Step,
  stepRuntime: Awaited<ReturnType<typeof createStepRunScope>>,
  success: boolean,
  runtimeEvents: RuntimeDelegationEvent[],
) {
  const currentState = await readThreadSurfaceState(bp)
  const finalized = finalizeStepRunWithRuntimeEvents(currentState, {
    step,
    stepRun: stepRuntime.stepRun,
    success,
    endedAt: new Date().toISOString(),
    runtimeEvents,
    nextRunId: randomUUID,
    nextEventId: randomUUID,
    nextMergeId: randomUUID,
  })

  if (finalized.stepRun != null) {
    await writeThreadSurfaceState(bp, finalized.state)
  }

  if (finalized.pendingChildSequences.length > 0) {
    await provisionAllChildSequences(bp, finalized.pendingChildSequences)
  }
}

async function finalizeRunScope(bp: string, runId: string, success: boolean, runSummary: string) {
  const currentState = await readThreadSurfaceState(bp)
  const nextState = completeRun(currentState, {
    runId,
    runStatus: success ? 'successful' : 'failed',
    endedAt: new Date().toISOString(),
    runSummary,
  }).state
  await writeThreadSurfaceState(bp, nextState)
}

export async function POST(request: Request) {
  try {
    const body = BodySchema.parse(await request.json())
    const denied = await checkPolicy('run_command')
    if (denied) return jsonError(denied, 'POLICY_DENIED', 403)

    const bp = getBasePath()
    const seq = await readSequence(bp)
    validateDAG(seq)
    const runId = randomUUID()
    const startedAt = new Date().toISOString()

    await createRunScopeForRequest(bp, seq.name, runId, startedAt)

    if ('stepId' in body) {
      const result = await executeStep(bp, seq, body.stepId, runId)
      await finalizeRunScope(bp, runId, result.success, `step:${body.stepId}`)
      await auditLog('run.step', body.stepId, { runId }, result.success ? 'ok' : 'failed')
      return NextResponse.json(result)
    }
    if ('groupId' in body) {
      const groupSteps = getRunnableSteps(seq).filter(s => s.group_id === body.groupId)
      const results = []
      for (const step of groupSteps) {
        results.push(await executeStep(bp, seq, step.id, runId))
      }
      const success = results.every(r => r.success)
      await finalizeRunScope(bp, runId, success, `group:${body.groupId}`)
      await auditLog('run.group', body.groupId, { runId, count: results.length })
      return NextResponse.json({ success, executed: results })
    }

    const runnable = getRunnableSteps(seq)
    const order = topologicalSort(seq)
    const ordered = order.filter(id => runnable.some(s => s.id === id))
    const results = []
    for (const id of ordered) {
      results.push(await executeStep(bp, seq, id, runId))
    }
    const success = results.every(r => r.success)
    await finalizeRunScope(bp, runId, success, 'mode:runnable')
    await auditLog('run.runnable', '*', { runId, count: results.length })
    return NextResponse.json({ success, executed: results })
  } catch (err) {
    return handleError(err)
  }
}


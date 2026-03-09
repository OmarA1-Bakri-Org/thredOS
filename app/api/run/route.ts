import { NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { readSequence, writeSequence } from '@/lib/sequence/parser'
import { validateDAG, topologicalSort } from '@/lib/sequence/dag'
import { getBasePath } from '@/lib/config'
import { jsonError, auditLog, checkPolicy, handleError } from '@/lib/api-helpers'
import type { Sequence, Step } from '@/lib/sequence/schema'
import { runStep } from '@/lib/runner/wrapper'
import { saveRunArtifacts } from '@/lib/runner/artifacts'
import { readThreadSurfaceState, writeThreadSurfaceState } from '@/lib/thread-surfaces/repository'
import { completeRun, createReplacementRun, createRootThreadSurfaceRun, recordMergeEvent } from '@/lib/thread-surfaces/mutations'
import { ROOT_THREAD_SURFACE_ID } from '@/lib/thread-surfaces/constants'
import { deriveMergeEventForSuccessfulStep } from '@/lib/thread-surfaces/merge-runtime'
import { deriveStepThreadSurfaceId, resolveStepRuntimeState } from '@/lib/thread-surfaces/step-runtime'

const BodySchema = z.union([
  z.object({ stepId: z.string() }),
  z.object({ mode: z.literal('runnable') }),
  z.object({ groupId: z.string() }),
])

interface RunRouteRuntime {
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

  const stepRuntime = await createStepRunScope(bp, step)
  step.status = 'RUNNING'
  await writeSequence(bp, seq)
  try {
    const runtime = getRunRouteRuntime()
    const result = await runtime.runStep({ stepId, runId, command: step.model, args: ['--prompt-file', step.prompt_file], cwd: step.cwd })
    const artifactPath = await runtime.saveRunArtifacts(bp, result)
    step.status = result.status === 'SUCCESS' ? 'DONE' : 'FAILED'
    await writeSequence(bp, seq)
    await finalizeStepRunScope(bp, seq, step, stepRuntime, result.status === 'SUCCESS')
    return { success: result.status === 'SUCCESS', stepId, runId, status: step.status, duration: result.duration, artifactPath }
  } catch (err) {
    step.status = 'FAILED'
    await writeSequence(bp, seq).catch(() => {})
    await finalizeStepRunScope(bp, seq, step, stepRuntime, false).catch(() => {})
    return { success: false, stepId, runId, status: 'FAILED' as const, error: err instanceof Error ? err.message : String(err) }
  }
}

function getRunRouteRuntime(): RunRouteRuntime {
  return globalThis.__THREADOS_RUN_ROUTE_RUNTIME__ ?? {
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

async function createStepRunScope(bp: string, step: Step) {
  const currentState = await readThreadSurfaceState(bp)
  const runId = randomUUID()
  const startedAt = new Date().toISOString()
  const executionIndex = currentState.runs.length + 1
  const resolution = resolveStepRuntimeState({
    state: currentState,
    step: {
      id: step.id,
      name: step.name,
      orchestrator: step.orchestrator,
    },
    runId,
    startedAt,
    executionIndex,
  })

  await writeThreadSurfaceState(bp, resolution.state)

  return {
    runId,
    startedAt,
    executionIndex,
    threadSurfaceId: resolution.threadSurfaceId,
  }
}

async function finalizeStepRunScope(
  bp: string,
  seq: Sequence,
  step: Step,
  stepRuntime: Awaited<ReturnType<typeof createStepRunScope>>,
  success: boolean,
) {
  const currentState = await readThreadSurfaceState(bp)
  let nextState = completeRun(currentState, {
    runId: stepRuntime.runId,
    runStatus: success ? 'successful' : 'failed',
    endedAt: new Date().toISOString(),
    runSummary: success ? `step:${step.id}` : `step:${step.id}:failed`,
  }).state

  if (success) {
    const mergeEvent = deriveMergeEventForSuccessfulStep({
      step,
      threadSurfaces: nextState.threadSurfaces,
      stepThreadSurfaceIds: Object.fromEntries(seq.steps.map(sequenceStep => [sequenceStep.id, deriveStepThreadSurfaceId(sequenceStep.id)])),
      runId: stepRuntime.runId,
      mergeId: randomUUID(),
      executionIndex: stepRuntime.executionIndex,
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

  await writeThreadSurfaceState(bp, nextState)
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

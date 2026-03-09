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
import { completeRun, createReplacementRun, createRootThreadSurfaceRun } from '@/lib/thread-surfaces/mutations'

const ROOT_THREAD_SURFACE_ID = 'thread-root'

const BodySchema = z.union([
  z.object({ stepId: z.string() }),
  z.object({ mode: z.literal('runnable') }),
  z.object({ groupId: z.string() }),
])

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
  step.status = 'RUNNING'
  await writeSequence(bp, seq)
  try {
    const result = await runStep({ stepId, runId, command: step.model, args: ['--prompt-file', step.prompt_file], cwd: step.cwd })
    const artifactPath = await saveRunArtifacts(bp, result)
    step.status = result.status === 'SUCCESS' ? 'DONE' : 'FAILED'
    await writeSequence(bp, seq)
    return { success: result.status === 'SUCCESS', stepId, runId, status: step.status, duration: result.duration, artifactPath }
  } catch (err) {
    step.status = 'FAILED'
    await writeSequence(bp, seq).catch(() => {})
    return { success: false, stepId, runId, status: 'FAILED' as const, error: err instanceof Error ? err.message : String(err) }
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
      const results = await Promise.all(groupSteps.map(s => executeStep(bp, seq, s.id, runId)))
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

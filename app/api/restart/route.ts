import { NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { readSequence, writeSequence } from '@/lib/sequence/parser'
import { getBasePath } from '@/lib/config'
import { auditLog, handleError } from '@/lib/api-helpers'
import { readMprocsMap } from '@/lib/mprocs/state'
import { StepNotFoundError } from '@/lib/errors'
import { ROOT_THREAD_SURFACE_ID } from '@/lib/thread-surfaces/constants'
import { readThreadSurfaceState, writeThreadSurfaceState } from '@/lib/thread-surfaces/repository'
import { createReplacementRun, createRootThreadSurfaceRun } from '@/lib/thread-surfaces/mutations'
const BodySchema = z.object({ stepId: z.string() })

export async function POST(request: Request) {
  try {
    const { stepId } = BodySchema.parse(await request.json())
    const bp = getBasePath()
    const seq = await readSequence(bp)
    const step = seq.steps.find(s => s.id === stepId)
    if (!step) throw new StepNotFoundError(stepId)

    const mprocsMap = await readMprocsMap(bp)
    const idx = mprocsMap[stepId]
    if (idx !== undefined) {
      try {
        const { MprocsClient } = await import('@/lib/mprocs/client')
        await new MprocsClient().restartProcess(idx)
      } catch (error) {
        console.error(`[restart] Failed to restart mprocs process for step '${stepId}':`, error)
      }
    }
    step.status = 'RUNNING'
    await writeSequence(bp, seq)

    const currentState = await readThreadSurfaceState(bp)
    const startedAt = new Date().toISOString()
    const nextState = currentState.threadSurfaces.some(surface => surface.id === ROOT_THREAD_SURFACE_ID)
      ? createReplacementRun(currentState, {
          threadSurfaceId: ROOT_THREAD_SURFACE_ID,
          runId: randomUUID(),
          startedAt,
          executionIndex: currentState.runs.length + 1,
        }).state
      : createRootThreadSurfaceRun(currentState, {
          surfaceId: ROOT_THREAD_SURFACE_ID,
          surfaceLabel: seq.name,
          createdAt: startedAt,
          runId: randomUUID(),
          startedAt,
          executionIndex: currentState.runs.length + 1,
        }).state
    await writeThreadSurfaceState(bp, nextState)

    await auditLog('restart', stepId)
    return NextResponse.json({ success: true, action: 'restart', stepId })
  } catch (err) {
    return handleError(err)
  }
}

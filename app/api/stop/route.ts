import { NextResponse } from 'next/server'
import { z } from 'zod'
import { readSequence, writeSequence } from '@/lib/sequence/parser'
import { getBasePath } from '@/lib/config'
import { auditLog, handleError, jsonError, requireRequestSession } from '@/lib/api-helpers'
import { allowHostedProcessControls } from '@/lib/hosted'
import { readMprocsMap } from '@/lib/mprocs/state'
import { StepNotFoundError } from '@/lib/errors'
import { applyRateLimit } from '@/lib/rate-limit'
import { ROOT_THREAD_SURFACE_ID } from '@/lib/thread-surfaces/constants'
import { readThreadSurfaceState, withThreadSurfaceStateRevision, writeThreadSurfaceState } from '@/lib/thread-surfaces/repository'
import { cancelRun, findLatestActiveRunForSurface } from '@/lib/thread-surfaces/mutations'

const BodySchema = z.object({ stepId: z.string() })

export async function POST(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const rateLimited = applyRateLimit(request, {
      bucket: 'stop',
      limit: 30,
      windowMs: 5 * 60 * 1000,
    })
    if (rateLimited) return rateLimited
    if (!allowHostedProcessControls()) {
      return NextResponse.json({
        error: 'Stop is disabled in hosted mode for the thredOS Desktop launch',
        code: 'PROCESS_CONTROL_DISABLED',
      }, { status: 403 })
    }
    const { stepId } = BodySchema.parse(await request.json())
    const bp = getBasePath()
    const seq = await readSequence(bp)
    const step = seq.steps.find(s => s.id === stepId)
    if (!step) throw new StepNotFoundError(stepId)

    const mprocsMap = await readMprocsMap(bp)
    const idx = mprocsMap[stepId]
    if (idx === undefined) {
      return jsonError(`Step '${stepId}' does not have a tracked process to stop`, 'PROCESS_NOT_TRACKED', 409)
    }

    const { MprocsClient } = await import('@/lib/mprocs/client')
    const controlResult = await new MprocsClient().stopProcess(idx)
    if (!controlResult.success) {
      return jsonError(
        controlResult.stderr || `Failed to stop step '${stepId}' via mprocs`,
        'PROCESS_CONTROL_FAILED',
        502,
      )
    }

    step.status = 'FAILED'
    await writeSequence(bp, seq)

    const currentState = await readThreadSurfaceState(bp)
    const activeRun = findLatestActiveRunForSurface(currentState.runs, ROOT_THREAD_SURFACE_ID)
    if (activeRun) {
      const nextState = withThreadSurfaceStateRevision(currentState, cancelRun(currentState, {
        runId: activeRun.id,
        endedAt: new Date().toISOString(),
      }).state)
      await writeThreadSurfaceState(bp, nextState)
    }

    await auditLog('stop', stepId)
    return NextResponse.json({ success: true, action: 'stop', stepId })
  } catch (err) {
    return handleError(err)
  }
}

import { z } from 'zod'
import { NextResponse } from 'next/server'
import { getBasePath } from '@/lib/config'
import { handleError, jsonError, requireRequestSession } from '@/lib/api-helpers'
import { ThreadSurfaceNotFoundError, ThreadSurfaceRunNotFoundError } from '@/lib/errors'
import { resolveSurfaceAnnotations } from '@/lib/thread-surfaces/annotations'
import { readThreadSurfaceState, updateThreadSurfaceState } from '@/lib/thread-surfaces/repository'

const BodySchema = z.object({
  surfaceId: z.string(),
  runId: z.string(),
  runSummary: z.string().nullable().optional(),
  runNotes: z.string().nullable().optional(),
  runDiscussion: z.string().nullable().optional(),
})

export async function GET(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const params = new URL(request.url).searchParams
    const surfaceId = params.get('surfaceId')
    const runId = params.get('runId') ?? undefined
    if (!surfaceId) {
      return jsonError('surfaceId is required', 'VALIDATION_ERROR', 400)
    }

    const state = await readThreadSurfaceState(getBasePath())
    const surface = state.threadSurfaces.find(candidate => candidate.id === surfaceId)
    if (!surface) {
      return jsonError(`Thread surface ${surfaceId} not found`, 'NOT_FOUND', 404)
    }

    return NextResponse.json(resolveSurfaceAnnotations({
      surface,
      runs: state.runs,
      selectedRunId: runId,
    }))
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const body = BodySchema.parse(await request.json())
    const state = await updateThreadSurfaceState(getBasePath(), (currentState) => {
      const surfaceExists = currentState.threadSurfaces.some(surface => surface.id === body.surfaceId)
      if (!surfaceExists) {
        throw new ThreadSurfaceNotFoundError(body.surfaceId)
      }

      const runIndex = currentState.runs.findIndex(run => run.id === body.runId && run.threadSurfaceId === body.surfaceId)
      if (runIndex === -1) {
        throw new ThreadSurfaceRunNotFoundError(body.surfaceId, body.runId)
      }

      const nextRuns = [...currentState.runs]
      nextRuns[runIndex] = {
        ...nextRuns[runIndex],
        ...(body.runSummary !== undefined ? { runSummary: body.runSummary ?? undefined } : {}),
        ...(body.runNotes !== undefined ? { runNotes: body.runNotes ?? undefined } : {}),
        ...(body.runDiscussion !== undefined ? { runDiscussion: body.runDiscussion ?? undefined } : {}),
      }

      return {
        ...currentState,
        runs: nextRuns,
      }
    })

    const surface = state.threadSurfaces.find(candidate => candidate.id === body.surfaceId)
    if (!surface) {
      throw new ThreadSurfaceNotFoundError(body.surfaceId)
    }

    return NextResponse.json({
      success: true,
      surfaceId: body.surfaceId,
      runId: body.runId,
      annotations: resolveSurfaceAnnotations({
        surface,
        runs: state.runs,
        selectedRunId: body.runId,
      }),
    })
  } catch (err) {
    return handleError(err)
  }
}

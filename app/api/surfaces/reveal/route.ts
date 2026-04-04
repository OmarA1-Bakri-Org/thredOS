import { NextResponse } from 'next/server'
import { canReveal, revealSurface } from '@/lib/barriers/reveal'
import { createBarrierAttestation } from '@/lib/barriers/barrier-attestation'
import { appendTraceEvent } from '@/lib/traces/writer'
import { readThreadSurfaceState, writeThreadSurfaceState } from '@/lib/thread-surfaces/repository'
import { getBasePath } from '@/lib/config'
import { handleError, requireRequestSession } from '@/lib/api-helpers'
import { normalizeThreadSurface } from '@/lib/thread-surfaces/types'

export async function POST(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session

    const body = await request.json()
    const { surfaceId, runId } = body
    if (!surfaceId) {
      return NextResponse.json({ error: 'surfaceId required', code: 'MISSING_PARAM' }, { status: 400 })
    }
    if (!runId) {
      return NextResponse.json({ error: 'runId required', code: 'MISSING_PARAM' }, { status: 400 })
    }

    const bp = getBasePath()
    const state = await readThreadSurfaceState(bp)

    const surfaceIndex = state.threadSurfaces.findIndex(s => s.id === surfaceId)
    if (surfaceIndex === -1) {
      return NextResponse.json({ error: `Surface not found: ${surfaceId}`, code: 'NOT_FOUND' }, { status: 404 })
    }

    const surface = normalizeThreadSurface(state.threadSurfaces[surfaceIndex])
    if (!canReveal(surface)) {
      return NextResponse.json(
        { error: `Cannot reveal surface ${surfaceId}: surfaceClass=${surface.surfaceClass}, revealState=${surface.revealState}`, code: 'REVEAL_NOT_ALLOWED' },
        { status: 409 },
      )
    }

    const revealed = revealSurface(surface)

    const updatedSurfaces = state.threadSurfaces.map((s, i) => (i === surfaceIndex ? revealed : s))
    const updatedState = { ...state, threadSurfaces: updatedSurfaces }
    await writeThreadSurfaceState(bp, updatedState)

    const attestation = createBarrierAttestation({
      surfaceId,
      runId,
      isolationLabel: revealed.isolationLabel,
      revealState: revealed.revealState ?? 'revealed',
    })

    const ts = new Date().toISOString()
    await appendTraceEvent(bp, runId, {
      ts,
      run_id: runId,
      surface_id: surfaceId,
      actor: 'api:surfaces/reveal',
      event_type: 'surface-revealed',
      payload_ref: null,
      policy_ref: null,
    })
    await appendTraceEvent(bp, runId, {
      ts,
      run_id: runId,
      surface_id: surfaceId,
      actor: 'api:surfaces/reveal',
      event_type: 'barrier-attested',
      payload_ref: null,
      policy_ref: null,
    })

    return NextResponse.json({ surface: revealed, attestation })
  } catch (err) {
    return handleError(err)
  }
}

import { NextResponse } from 'next/server'
import { getBasePath } from '@/lib/config'
import { handleError, requireRequestSession } from '@/lib/api-helpers'
import { readThreadSurfaceState, withThreadSurfaceStateRevision, writeThreadSurfaceState } from '@/lib/thread-surfaces/repository'
import { readSequence } from '@/lib/sequence/parser'
import { reconcileSurfacesWithSequence } from '@/lib/thread-surfaces/materializer'

export async function GET(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const bp = getBasePath()
    const seq = await readSequence(bp)
    let state = await readThreadSurfaceState(bp)

    const reconciled = reconcileSurfacesWithSequence(
      state,
      seq.steps.map(s => ({ id: s.id, name: s.name })),
      seq.name,
      new Date().toISOString(),
    )

    if (reconciled !== state) {
      try {
        await writeThreadSurfaceState(bp, withThreadSurfaceStateRevision(state, reconciled))
        state = reconciled
      } catch (err) {
        console.error('[thread-surfaces.GET] reconciliation write failed (non-fatal):', err)
      }
    }

    return NextResponse.json({ threadSurfaces: state.threadSurfaces })
  } catch (err) {
    return handleError(err)
  }
}

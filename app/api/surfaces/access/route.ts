import { NextResponse } from 'next/server'
import { resolveAccess } from '@/lib/barriers/access-resolver'
import { readThreadSurfaceState } from '@/lib/thread-surfaces/repository'
import { PolicyEngine } from '@/lib/policy/engine'
import { getBasePath } from '@/lib/config'
import { handleError, requireRequestSession } from '@/lib/api-helpers'
import { normalizeThreadSurface } from '@/lib/thread-surfaces/types'

export async function GET(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session

    const { searchParams } = new URL(request.url)
    const surfaceId = searchParams.get('surfaceId')
    const requestorSurfaceId = searchParams.get('requestorSurfaceId')
    if (!surfaceId || !requestorSurfaceId) {
      return NextResponse.json(
        { error: 'surfaceId and requestorSurfaceId required', code: 'MISSING_PARAM' },
        { status: 400 },
      )
    }

    const bp = getBasePath()
    const [state, policyEngine] = await Promise.all([
      readThreadSurfaceState(bp),
      PolicyEngine.load(bp),
    ])

    const rawSurface = state.threadSurfaces.find(s => s.id === surfaceId)
    if (!rawSurface) {
      return NextResponse.json({ error: `Surface not found: ${surfaceId}`, code: 'NOT_FOUND' }, { status: 404 })
    }
    const surface = normalizeThreadSurface(rawSurface)

    const policy = policyEngine.getConfig()
    const result = resolveAccess({
      surfaceId: surface.id,
      surfaceClass: surface.surfaceClass,
      visibility: surface.visibility,
      revealState: surface.revealState,
      requestorSurfaceId,
      allowedReadScopes: surface.allowedReadScopes,
      crossSurfaceReads: policy.cross_surface_reads,
    })

    return NextResponse.json({ access: result, surfaceId, requestorSurfaceId })
  } catch (err) {
    return handleError(err)
  }
}

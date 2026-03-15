import { NextResponse } from 'next/server'
import { getBasePath } from '@/lib/config'
import { handleError } from '@/lib/api-helpers'
import { readThreadSurfaceState, writeThreadSurfaceState } from '@/lib/thread-surfaces/repository'
import { readSequence } from '@/lib/sequence/parser'
import { reconcileSurfacesWithSequence } from '@/lib/thread-surfaces/materializer'

export async function GET() {
  try {
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
      await writeThreadSurfaceState(bp, reconciled)
      state = reconciled
    }

    return NextResponse.json({ threadSurfaces: state.threadSurfaces })
  } catch (err) {
    return handleError(err)
  }
}

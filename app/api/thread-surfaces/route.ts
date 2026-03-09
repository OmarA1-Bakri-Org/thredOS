import { NextResponse } from 'next/server'
import { getBasePath } from '@/lib/config'
import { handleError } from '@/lib/api-helpers'
import { readThreadSurfaceState } from '@/lib/thread-surfaces/repository'

export async function GET() {
  try {
    const state = await readThreadSurfaceState(getBasePath())
    return NextResponse.json({ threadSurfaces: state.threadSurfaces })
  } catch (err) {
    return handleError(err)
  }
}

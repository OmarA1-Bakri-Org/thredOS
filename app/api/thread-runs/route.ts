import { NextResponse } from 'next/server'
import { getBasePath } from '@/lib/config'
import { handleError } from '@/lib/api-helpers'
import { readThreadSurfaceState } from '@/lib/thread-surfaces/repository'

export async function GET(request: Request) {
  try {
    const threadSurfaceId = new URL(request.url).searchParams.get('threadSurfaceId')
    const state = await readThreadSurfaceState(getBasePath())
    const runs = threadSurfaceId
      ? state.runs.filter(run => run.threadSurfaceId === threadSurfaceId)
      : state.runs
    return NextResponse.json({ runs })
  } catch (err) {
    return handleError(err)
  }
}

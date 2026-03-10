import { NextResponse } from 'next/server'
import { getBasePath } from '@/lib/config'
import { handleError } from '@/lib/api-helpers'
import { readThreadSurfaceState } from '@/lib/thread-surfaces/repository'

export async function GET(request: Request) {
  try {
    const runId = new URL(request.url).searchParams.get('runId')
    const state = await readThreadSurfaceState(getBasePath())
    const mergeEvents = runId
      ? state.mergeEvents.filter(event => event.runId === runId)
      : state.mergeEvents
    return NextResponse.json({ mergeEvents })
  } catch (err) {
    return handleError(err)
  }
}

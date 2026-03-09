import { existsSync } from 'fs'
import { mkdir, readFile } from 'fs/promises'
import { join } from 'path'
import { writeFileAtomic } from '@/lib/fs/atomic'
import type { MergeEvent, RunScope, ThreadSurface } from './types'

const THREAD_SURFACE_STATE_PATH = '.threados/state/thread-surfaces.json'

export interface ThreadSurfaceState {
  version: 1
  threadSurfaces: ThreadSurface[]
  runs: RunScope[]
  mergeEvents: MergeEvent[]
}

const DEFAULT_THREAD_SURFACE_STATE: ThreadSurfaceState = {
  version: 1,
  threadSurfaces: [],
  runs: [],
  mergeEvents: [],
}

export function getThreadSurfaceStatePath(basePath: string): string {
  return join(basePath, THREAD_SURFACE_STATE_PATH)
}

export async function readThreadSurfaceState(basePath: string): Promise<ThreadSurfaceState> {
  const fullPath = getThreadSurfaceStatePath(basePath)
  if (!existsSync(fullPath)) {
    return structuredClone(DEFAULT_THREAD_SURFACE_STATE)
  }

  const raw = JSON.parse(await readFile(fullPath, 'utf-8')) as Partial<ThreadSurfaceState>

  return {
    version: 1,
    threadSurfaces: Array.isArray(raw.threadSurfaces) ? raw.threadSurfaces : [],
    runs: Array.isArray(raw.runs) ? raw.runs : [],
    mergeEvents: Array.isArray(raw.mergeEvents) ? raw.mergeEvents : [],
  }
}

export async function writeThreadSurfaceState(basePath: string, state: ThreadSurfaceState): Promise<void> {
  const fullPath = getThreadSurfaceStatePath(basePath)
  await mkdir(join(basePath, '.threados/state'), { recursive: true })
  await writeFileAtomic(fullPath, `${JSON.stringify({ ...state, version: 1 }, null, 2)}\n`)
}

export async function updateThreadSurfaceState(
  basePath: string,
  updater: (currentState: ThreadSurfaceState) => ThreadSurfaceState | Promise<ThreadSurfaceState>,
): Promise<ThreadSurfaceState> {
  const currentState = await readThreadSurfaceState(basePath)
  const nextState = await updater(currentState)
  await writeThreadSurfaceState(basePath, nextState)
  return nextState
}

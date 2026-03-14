import { existsSync } from 'fs'
import { mkdir, readFile } from 'fs/promises'
import { join } from 'path'
import { writeFileAtomic } from '@/lib/fs/atomic'
import type { MergeEvent, RunEvent, RunScope, ThreadSurface } from './types'

const THREAD_SURFACE_STATE_PATH = '.threados/state/thread-surfaces.json'

export interface ThreadSurfaceState {
  version: 1
  threadSurfaces: ThreadSurface[]
  runs: RunScope[]
  mergeEvents: MergeEvent[]
  runEvents: RunEvent[]
}

const DEFAULT_THREAD_SURFACE_STATE: ThreadSurfaceState = {
  version: 1,
  threadSurfaces: [],
  runs: [],
  mergeEvents: [],
  runEvents: [],
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
    mergeEvents: Array.isArray(raw.mergeEvents)
      ? raw.mergeEvents.map(normalizeMergeEvent)
      : [],
    runEvents: Array.isArray(raw.runEvents) ? raw.runEvents : [],
  }
}

export async function writeThreadSurfaceState(basePath: string, state: ThreadSurfaceState): Promise<void> {
  const fullPath = getThreadSurfaceStatePath(basePath)
  await mkdir(join(basePath, '.threados/state'), { recursive: true })
  await writeFileAtomic(fullPath, `${JSON.stringify({ ...state, version: 1 }, null, 2)}\n`)
}

const MERGE_EVENT_DEFAULTS: Omit<MergeEvent, 'summary'> = {
  id: '',
  runId: '',
  destinationThreadSurfaceId: '',
  sourceThreadSurfaceIds: [],
  sourceRunIds: [],
  mergeKind: 'single',
  executionIndex: 0,
  createdAt: '',
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value : []
}

function normalizeMergeEvent(raw: Partial<MergeEvent>): MergeEvent {
  return {
    id: raw.id ?? MERGE_EVENT_DEFAULTS.id,
    runId: raw.runId ?? MERGE_EVENT_DEFAULTS.runId,
    destinationThreadSurfaceId: raw.destinationThreadSurfaceId ?? MERGE_EVENT_DEFAULTS.destinationThreadSurfaceId,
    sourceThreadSurfaceIds: normalizeStringArray(raw.sourceThreadSurfaceIds),
    sourceRunIds: normalizeStringArray(raw.sourceRunIds),
    mergeKind: raw.mergeKind ?? MERGE_EVENT_DEFAULTS.mergeKind,
    executionIndex: raw.executionIndex ?? MERGE_EVENT_DEFAULTS.executionIndex,
    createdAt: raw.createdAt ?? MERGE_EVENT_DEFAULTS.createdAt,
    ...(raw.summary ? { summary: raw.summary } : {}),
  }
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

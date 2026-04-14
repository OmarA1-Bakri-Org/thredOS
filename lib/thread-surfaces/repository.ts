import { existsSync } from 'fs'
import { mkdir, readFile } from 'fs/promises'
import { join } from 'path'
import { writeFileAtomic } from '@/lib/fs/atomic'
import { ThreadSurfaceStateConflictError } from '@/lib/errors'
import { normalizeThreadSurface, type MergeEvent, type RunEvent, type RunScope, type ThreadSurface } from './types'

const THREAD_SURFACE_STATE_PATH = '.threados/state/thread-surfaces.json'
const THREAD_SURFACE_STATE_REVISION = Symbol('thredos.threadSurfaceStateRevision')

export interface ThreadSurfaceState {
  version: 1
  threadSurfaces: ThreadSurface[]
  runs: RunScope[]
  mergeEvents: MergeEvent[]
  runEvents: RunEvent[]
}

type ThreadSurfaceStateWithRevision = ThreadSurfaceState & {
  [THREAD_SURFACE_STATE_REVISION]?: string | null
}

const DEFAULT_THREAD_SURFACE_STATE: ThreadSurfaceState = {
  version: 1,
  threadSurfaces: [],
  runs: [],
  mergeEvents: [],
  runEvents: [],
}

function attachRevision<T extends ThreadSurfaceState>(state: T, revision: string | null): T {
  Object.defineProperty(state, THREAD_SURFACE_STATE_REVISION, {
    value: revision,
    enumerable: false,
    configurable: true,
    writable: true,
  })
  return state
}

function getRevision(state: ThreadSurfaceState): string | null | undefined {
  return (state as ThreadSurfaceStateWithRevision)[THREAD_SURFACE_STATE_REVISION]
}

async function readCurrentRevision(fullPath: string): Promise<string | null> {
  if (!existsSync(fullPath)) {
    return null
  }
  return await readFile(fullPath, 'utf-8')
}

export function withThreadSurfaceStateRevision<T extends ThreadSurfaceState>(
  currentState: ThreadSurfaceState,
  nextState: T,
): T {
  return attachRevision(nextState, getRevision(currentState) ?? null)
}

export function getThreadSurfaceStatePath(basePath: string): string {
  return join(basePath, THREAD_SURFACE_STATE_PATH)
}

export async function readThreadSurfaceState(basePath: string): Promise<ThreadSurfaceState> {
  const fullPath = getThreadSurfaceStatePath(basePath)
  if (!existsSync(fullPath)) {
    return attachRevision(structuredClone(DEFAULT_THREAD_SURFACE_STATE), null)
  }

  const content = await readFile(fullPath, 'utf-8')
  const raw = JSON.parse(content) as Partial<ThreadSurfaceState>

  return attachRevision({
    version: 1,
    threadSurfaces: (Array.isArray(raw.threadSurfaces) ? raw.threadSurfaces : []).map(surface =>
      normalizeThreadSurface(surface as ThreadSurface),
    ),
    runs: Array.isArray(raw.runs) ? raw.runs : [],
    mergeEvents: Array.isArray(raw.mergeEvents)
      ? raw.mergeEvents.map(normalizeMergeEvent)
      : [],
    runEvents: Array.isArray(raw.runEvents) ? raw.runEvents : [],
  }, content)
}

export async function writeThreadSurfaceState(basePath: string, state: ThreadSurfaceState): Promise<void> {
  const fullPath = getThreadSurfaceStatePath(basePath)
  const currentRevision = await readCurrentRevision(fullPath)
  const expectedRevision = getRevision(state)

  if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
    throw new ThreadSurfaceStateConflictError()
  }

  await mkdir(join(basePath, '.threados/state'), { recursive: true })
  const content = `${JSON.stringify({ ...state, version: 1 }, null, 2)}\n`
  await writeFileAtomic(fullPath, content)
  attachRevision(state, content)
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
  const nextState = withThreadSurfaceStateRevision(currentState, await updater(currentState))
  await writeThreadSurfaceState(basePath, nextState)
  return nextState
}

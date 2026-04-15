import { existsSync } from 'fs'
import { mkdir, readFile, readdir, rm } from 'fs/promises'
import { join } from 'path'
import { writeFileAtomic } from '@/lib/fs/atomic'
import { ThreadSurfaceStateConflictError } from '@/lib/errors'
import {
  normalizeThreadSurface,
  type MergeEvent,
  type NormalizedThreadSurface,
  type RunEvent,
  type RunScope,
  type ThreadSurface,
} from './types'

const THREAD_SURFACE_STATE_PATH = '.threados/state/thread-surfaces.json'
const THREAD_SURFACE_RECORDS_PATH = '.threados/surfaces'
const THREAD_SURFACE_STATE_REVISION = Symbol('thredos.threadSurfaceStateRevision')

export interface ThreadSurfaceState {
  version: 1
  threadSurfaces: ThreadSurface[]
  runs: RunScope[]
  mergeEvents: MergeEvent[]
  runEvents: RunEvent[]
}

interface SurfaceRecordJson {
  version: 1
  surface: NormalizedThreadSurface
}

interface SurfaceAccessJson {
  version: 1
  surfaceId: string
  surfaceClass: NormalizedThreadSurface['surfaceClass']
  visibility: NormalizedThreadSurface['visibility']
  revealState: NormalizedThreadSurface['revealState']
  allowedReadScopes: string[]
  allowedWriteScopes: string[]
}

interface SurfaceBarrierJson {
  version: 1
  surfaceId: string
  surfaceClass: NormalizedThreadSurface['surfaceClass']
  isolationLabel: NormalizedThreadSurface['isolationLabel']
  revealState: NormalizedThreadSurface['revealState']
  manifestOnlyProjection: boolean
  sharedSemanticProjection: boolean
}

interface SurfaceStateJson {
  version: 1
  surfaceId: string
  parentSurfaceId: string | null
  childSurfaceIds: string[]
  runCount: number
  latestRunId: string | null
  latestRunStatus: RunScope['runStatus'] | null
  runEventCount: number
  mergeEventCount: number
  lastEventAt: string | null
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

function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
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

function getThreadSurfaceRecordsRootPath(basePath: string): string {
  return join(basePath, THREAD_SURFACE_RECORDS_PATH)
}

function getThreadSurfaceRecordDirectory(basePath: string, surfaceId: string): string {
  return join(getThreadSurfaceRecordsRootPath(basePath), surfaceId)
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

async function listCanonicalSurfaceIds(basePath: string): Promise<string[]> {
  try {
    const entries = await readdir(getThreadSurfaceRecordsRootPath(basePath), { withFileTypes: true })
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort((left, right) => left.localeCompare(right))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }
}

async function readCanonicalThreadSurfaces(basePath: string): Promise<NormalizedThreadSurface[] | null> {
  const surfaceIds = await listCanonicalSurfaceIds(basePath)
  if (surfaceIds.length === 0) {
    return null
  }

  const surfaces = await Promise.all(surfaceIds.map(async surfaceId => {
    try {
      const content = await readFile(join(getThreadSurfaceRecordDirectory(basePath, surfaceId), 'surface.json'), 'utf-8')
      const raw = JSON.parse(content) as SurfaceRecordJson | NormalizedThreadSurface
      const surface = 'surface' in raw ? raw.surface : raw
      return normalizeThreadSurface(surface as ThreadSurface)
    } catch {
      return null
    }
  }))

  const validSurfaces = surfaces.filter((surface): surface is NormalizedThreadSurface => surface != null)
  return validSurfaces.length > 0 ? validSurfaces : null
}

function buildSurfaceRecord(surface: NormalizedThreadSurface): SurfaceRecordJson {
  return {
    version: 1,
    surface,
  }
}

function buildSurfaceAccessRecord(surface: NormalizedThreadSurface): SurfaceAccessJson {
  return {
    version: 1,
    surfaceId: surface.id,
    surfaceClass: surface.surfaceClass,
    visibility: surface.visibility,
    revealState: surface.revealState,
    allowedReadScopes: surface.allowedReadScopes,
    allowedWriteScopes: surface.allowedWriteScopes,
  }
}

function buildSurfaceBarrierRecord(surface: NormalizedThreadSurface): SurfaceBarrierJson {
  const manifestOnlyProjection = surface.surfaceClass === 'sealed' && surface.revealState !== 'revealed'
  return {
    version: 1,
    surfaceId: surface.id,
    surfaceClass: surface.surfaceClass,
    isolationLabel: surface.isolationLabel,
    revealState: surface.revealState,
    manifestOnlyProjection,
    sharedSemanticProjection: !manifestOnlyProjection,
  }
}

function pickLatestRun(runs: RunScope[]): RunScope | null {
  return runs.reduce<RunScope | null>((latest, run) => {
    if (!latest) return run
    const latestTimestamp = latest.endedAt ?? latest.startedAt
    const nextTimestamp = run.endedAt ?? run.startedAt
    return Date.parse(nextTimestamp) >= Date.parse(latestTimestamp) ? run : latest
  }, null)
}

function pickLatestTimestamp(values: Array<string | null | undefined>): string | null {
  return values.reduce<string | null>((latest, value) => {
    if (!value) return latest
    if (!latest) return value
    return Date.parse(value) >= Date.parse(latest) ? value : latest
  }, null)
}

function buildSurfaceStateRecord(state: ThreadSurfaceState, surface: NormalizedThreadSurface): SurfaceStateJson {
  const surfaceRuns = state.runs.filter(run => run.threadSurfaceId === surface.id)
  const surfaceRunEvents = state.runEvents.filter(event => event.threadSurfaceId === surface.id)
  const surfaceMergeEvents = state.mergeEvents.filter(event =>
    event.destinationThreadSurfaceId === surface.id || event.sourceThreadSurfaceIds.includes(surface.id),
  )
  const latestRun = pickLatestRun(surfaceRuns)

  return {
    version: 1,
    surfaceId: surface.id,
    parentSurfaceId: surface.parentSurfaceId,
    childSurfaceIds: surface.childSurfaceIds,
    runCount: surfaceRuns.length,
    latestRunId: latestRun?.id ?? null,
    latestRunStatus: latestRun?.runStatus ?? null,
    runEventCount: surfaceRunEvents.length,
    mergeEventCount: surfaceMergeEvents.length,
    lastEventAt: pickLatestTimestamp([
      latestRun?.endedAt,
      latestRun?.startedAt,
      ...surfaceRunEvents.map(event => event.createdAt),
      ...surfaceMergeEvents.map(event => event.createdAt),
    ]),
  }
}

async function writeCanonicalThreadSurfaceRecords(basePath: string, state: ThreadSurfaceState): Promise<void> {
  const rootPath = getThreadSurfaceRecordsRootPath(basePath)
  await mkdir(rootPath, { recursive: true })

  const existingSurfaceIds = new Set(await listCanonicalSurfaceIds(basePath))
  const normalizedSurfaces = state.threadSurfaces.map(normalizeThreadSurface)

  await Promise.all(normalizedSurfaces.map(async surface => {
    existingSurfaceIds.delete(surface.id)
    const directoryPath = getThreadSurfaceRecordDirectory(basePath, surface.id)

    await Promise.all([
      writeFileAtomic(join(directoryPath, 'surface.json'), toJson(buildSurfaceRecord(surface))),
      writeFileAtomic(join(directoryPath, 'access.json'), toJson(buildSurfaceAccessRecord(surface))),
      writeFileAtomic(join(directoryPath, 'barrier.json'), toJson(buildSurfaceBarrierRecord(surface))),
      writeFileAtomic(join(directoryPath, 'state.json'), toJson(buildSurfaceStateRecord(state, surface))),
    ])
  }))

  await Promise.all(Array.from(existingSurfaceIds).map(async surfaceId => {
    await rm(getThreadSurfaceRecordDirectory(basePath, surfaceId), { recursive: true, force: true })
  }))
}

export async function readThreadSurfaceState(basePath: string): Promise<ThreadSurfaceState> {
  const fullPath = getThreadSurfaceStatePath(basePath)
  const canonicalThreadSurfaces = await readCanonicalThreadSurfaces(basePath)

  if (!existsSync(fullPath)) {
    const emptyState = structuredClone(DEFAULT_THREAD_SURFACE_STATE)
    return attachRevision({
      ...emptyState,
      threadSurfaces: canonicalThreadSurfaces ?? emptyState.threadSurfaces,
    }, null)
  }

  const content = await readFile(fullPath, 'utf-8')
  const raw = JSON.parse(content) as Partial<ThreadSurfaceState>

  return attachRevision({
    version: 1,
    threadSurfaces: canonicalThreadSurfaces ?? (Array.isArray(raw.threadSurfaces) ? raw.threadSurfaces : []).map(surface =>
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
  const nextState: ThreadSurfaceState = { ...state, version: 1 }
  const content = toJson(nextState)
  await writeFileAtomic(fullPath, content)
  await writeCanonicalThreadSurfaceRecords(basePath, nextState)
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

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { MergeEvent, RunScope, ThreadSurface } from './types'
import {
  getThreadSurfaceStatePath,
  readThreadSurfaceState,
  updateThreadSurfaceState,
  writeThreadSurfaceState,
} from './repository'

let basePath: string

const threadSurface: ThreadSurface = {
  id: 'thread-master',
  parentSurfaceId: null,
  parentAgentNodeId: null,
  depth: 0,
  surfaceLabel: 'Master',
  surfaceDescription: 'Top-level surface',
  role: 'orchestrator',
  createdAt: '2026-03-09T00:00:00.000Z',
  childSurfaceIds: ['thread-research'],
}

const run: RunScope = {
  id: 'run-master-1',
  threadSurfaceId: 'thread-master',
  runStatus: 'running',
  startedAt: '2026-03-09T00:00:00.000Z',
  endedAt: null,
  executionIndex: 1,
  runSummary: 'Master run',
  runNotes: 'Watch lane order',
  runDiscussion: 'AI notes',
}

const mergeEvent: MergeEvent = {
  id: 'merge-1',
  runId: 'run-master-1',
  destinationThreadSurfaceId: 'thread-master',
  sourceThreadSurfaceIds: ['thread-research'],
  mergeKind: 'single',
  executionIndex: 2,
  createdAt: '2026-03-09T00:03:00.000Z',
  summary: 'Research merged back in',
}

describe('thread surface repository', () => {
  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-thread-state-'))
  })

  afterEach(async () => {
    await rm(basePath, { recursive: true, force: true })
  })

  test('reading empty state returns empty collections', async () => {
    await expect(readThreadSurfaceState(basePath)).resolves.toEqual({
      version: 1,
      threadSurfaces: [],
      runs: [],
      mergeEvents: [],
    })
  })

  test('writing thread surfaces, runs, and merges persists atomically', async () => {
    await writeThreadSurfaceState(basePath, {
      version: 1,
      threadSurfaces: [threadSurface],
      runs: [run],
      mergeEvents: [mergeEvent],
    })

    const persisted = await readThreadSurfaceState(basePath)
    expect(persisted).toEqual({
      version: 1,
      threadSurfaces: [threadSurface],
      runs: [run],
      mergeEvents: [mergeEvent],
    })
  })

  test('repository reads from .threados/state/thread-surfaces.json', async () => {
    await writeThreadSurfaceState(basePath, {
      version: 1,
      threadSurfaces: [threadSurface],
      runs: [run],
      mergeEvents: [],
    })

    const filePath = getThreadSurfaceStatePath(basePath)
    const raw = JSON.parse(await readFile(filePath, 'utf-8'))
    expect(raw.threadSurfaces).toHaveLength(1)
    expect(raw.runs).toHaveLength(1)
    expect(raw.mergeEvents).toHaveLength(0)
  })

  test('updateThreadSurfaceState preserves local-first layout while changing content', async () => {
    const nextState = await updateThreadSurfaceState(basePath, () => ({
      version: 1,
      threadSurfaces: [threadSurface],
      runs: [run],
      mergeEvents: [],
    }))

    expect(nextState.threadSurfaces[0]?.id).toBe('thread-master')
    expect(nextState.runs[0]?.runNotes).toBe('Watch lane order')
    expect(getThreadSurfaceStatePath(basePath)).toBe(join(basePath, '.threados/state/thread-surfaces.json'))
  })
})

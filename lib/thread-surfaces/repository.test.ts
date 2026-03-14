import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { MergeEvent, RunEvent, RunScope, ThreadSurface } from './types'
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
  sequenceRef: null,
  spawnedByAgentId: null,
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
  parentRunId: null,
  childIndex: null,
}

const mergeEvent: MergeEvent = {
  id: 'merge-1',
  runId: 'run-master-1',
  destinationThreadSurfaceId: 'thread-master',
  sourceThreadSurfaceIds: ['thread-research'],
  sourceRunIds: ['run-research-1'],
  mergeKind: 'single',
  executionIndex: 2,
  createdAt: '2026-03-09T00:03:00.000Z',
  summary: 'Research merged back in',
}

const runEvent: RunEvent = {
  id: 'event-1',
  runId: 'run-master-1',
  eventType: 'child-agent-spawned',
  createdAt: '2026-03-09T00:01:00.000Z',
  threadSurfaceId: 'thread-master',
  payload: {
    childThreadSurfaceId: 'thread-research',
    parentThreadSurfaceId: 'thread-master',
  },
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
      runEvents: [],
    })
  })

  test('writing thread surfaces, runs, merges, and run events persists atomically', async () => {
    await writeThreadSurfaceState(basePath, {
      version: 1,
      threadSurfaces: [threadSurface],
      runs: [run],
      mergeEvents: [mergeEvent],
      runEvents: [runEvent],
    })

    const persisted = await readThreadSurfaceState(basePath)
    expect(persisted).toEqual({
      version: 1,
      threadSurfaces: [threadSurface],
      runs: [run],
      mergeEvents: [mergeEvent],
      runEvents: [runEvent],
    })
  })

  test('repository reads from .threados/state/thread-surfaces.json', async () => {
    await writeThreadSurfaceState(basePath, {
      version: 1,
      threadSurfaces: [threadSurface],
      runs: [run],
      mergeEvents: [],
      runEvents: [],
    })

    const filePath = getThreadSurfaceStatePath(basePath)
    const raw = JSON.parse(await readFile(filePath, 'utf-8'))
    expect(raw.threadSurfaces).toHaveLength(1)
    expect(raw.runs).toHaveLength(1)
    expect(raw.mergeEvents).toHaveLength(0)
    expect(raw.runEvents).toHaveLength(0)
  })

  test('readThreadSurfaceState defaults runEvents to an empty array when missing on disk', async () => {
    const filePath = getThreadSurfaceStatePath(basePath)
    await Bun.write(filePath, JSON.stringify({
      version: 1,
      threadSurfaces: [threadSurface],
      runs: [run],
      mergeEvents: [mergeEvent],
    }))

    await expect(readThreadSurfaceState(basePath)).resolves.toEqual({
      version: 1,
      threadSurfaces: [threadSurface],
      runs: [run],
      mergeEvents: [mergeEvent],
      runEvents: [],
    })
  })

  test('readThreadSurfaceState defaults merge sourceRunIds to an empty array when missing on disk', async () => {
    const filePath = getThreadSurfaceStatePath(basePath)
    await Bun.write(filePath, JSON.stringify({
      version: 1,
      threadSurfaces: [threadSurface],
      runs: [run],
      mergeEvents: [{
        ...mergeEvent,
        sourceRunIds: undefined,
      }],
      runEvents: [],
    }))

    await expect(readThreadSurfaceState(basePath)).resolves.toEqual({
      version: 1,
      threadSurfaces: [threadSurface],
      runs: [run],
      mergeEvents: [{
        ...mergeEvent,
        sourceRunIds: [],
      }],
      runEvents: [],
    })
  })

  test('updateThreadSurfaceState preserves existing state when only runEvents changes', async () => {
    await writeThreadSurfaceState(basePath, {
      version: 1,
      threadSurfaces: [threadSurface],
      runs: [run],
      mergeEvents: [mergeEvent],
      runEvents: [],
    })

    const nextState = await updateThreadSurfaceState(basePath, () => ({
      version: 1,
      threadSurfaces: [threadSurface],
      runs: [run],
      mergeEvents: [mergeEvent],
      runEvents: [runEvent],
    }))

    expect(nextState.threadSurfaces[0]?.id).toBe('thread-master')
    expect(nextState.runs[0]?.runNotes).toBe('Watch lane order')
    expect(nextState.mergeEvents).toEqual([mergeEvent])
    expect(nextState.runEvents).toEqual([runEvent])
    expect(getThreadSurfaceStatePath(basePath)).toBe(join(basePath, '.threados/state/thread-surfaces.json'))
  })
})

import { describe, expect, test } from 'bun:test'
import type { ThreadSurface } from './types'
import { createRootThreadSurfaceRun, createChildThreadSurfaceRun, emptyThreadSurfaceState } from './mutations'

const timestamp = '2026-03-28T10:00:00.000Z'

describe('ThreadSurface V.1 surface model', () => {
  test('ThreadSurface with surfaceClass=shared compiles and has correct fields', () => {
    const surface: ThreadSurface = {
      id: 'thread-shared',
      parentSurfaceId: null,
      parentAgentNodeId: null,
      depth: 0,
      surfaceLabel: 'Shared surface',
      createdAt: timestamp,
      childSurfaceIds: [],
      sequenceRef: null,
      spawnedByAgentId: null,
      surfaceClass: 'shared',
      visibility: 'dependency',
      isolationLabel: 'NONE',
      revealState: null,
      allowedReadScopes: [],
      allowedWriteScopes: [],
    }

    expect(surface.surfaceClass).toBe('shared')
    expect(surface.visibility).toBe('dependency')
    expect(surface.isolationLabel).toBe('NONE')
    expect(surface.revealState).toBeNull()
    expect(surface.allowedReadScopes).toEqual([])
    expect(surface.allowedWriteScopes).toEqual([])
  })

  test('ThreadSurface with surfaceClass=sealed has revealState=sealed', () => {
    const surface: ThreadSurface = {
      id: 'thread-sealed',
      parentSurfaceId: null,
      parentAgentNodeId: null,
      depth: 0,
      surfaceLabel: 'Sealed surface',
      createdAt: timestamp,
      childSurfaceIds: [],
      sequenceRef: null,
      spawnedByAgentId: null,
      surfaceClass: 'sealed',
      visibility: 'self_only',
      isolationLabel: 'THREADOS_SCOPED',
      revealState: 'sealed',
      allowedReadScopes: [],
      allowedWriteScopes: [],
    }

    expect(surface.surfaceClass).toBe('sealed')
    expect(surface.revealState).toBe('sealed')
    expect(surface.visibility).toBe('self_only')
    expect(surface.isolationLabel).toBe('THREADOS_SCOPED')
  })

  test('ThreadSurface accepts all four surfaceClass values', () => {
    const surfaceClasses: Array<ThreadSurface['surfaceClass']> = ['shared', 'private', 'sealed', 'control']

    for (const surfaceClass of surfaceClasses) {
      const surface: ThreadSurface = {
        id: `thread-${surfaceClass}`,
        parentSurfaceId: null,
        parentAgentNodeId: null,
        depth: 0,
        surfaceLabel: `${surfaceClass} surface`,
        createdAt: timestamp,
        childSurfaceIds: [],
        sequenceRef: null,
        spawnedByAgentId: null,
        surfaceClass,
        visibility: 'dependency',
        isolationLabel: 'NONE',
        revealState: null,
        allowedReadScopes: [],
        allowedWriteScopes: [],
      }
      expect(surface.surfaceClass).toBe(surfaceClass)
    }
  })

  test('ThreadSurface accepts revealState=revealed', () => {
    const surface: ThreadSurface = {
      id: 'thread-revealed',
      parentSurfaceId: null,
      parentAgentNodeId: null,
      depth: 0,
      surfaceLabel: 'Revealed surface',
      createdAt: timestamp,
      childSurfaceIds: [],
      sequenceRef: null,
      spawnedByAgentId: null,
      surfaceClass: 'sealed',
      visibility: 'public',
      isolationLabel: 'HOST_ENFORCED',
      revealState: 'revealed',
      allowedReadScopes: ['scope-a'],
      allowedWriteScopes: ['scope-b'],
    }

    expect(surface.revealState).toBe('revealed')
    expect(surface.allowedReadScopes).toEqual(['scope-a'])
    expect(surface.allowedWriteScopes).toEqual(['scope-b'])
  })

  test('createRootThreadSurfaceRun adds V.1 defaults to the root surface', () => {
    const result = createRootThreadSurfaceRun(emptyThreadSurfaceState, {
      surfaceId: 'thread-root',
      surfaceLabel: 'Root thread',
      createdAt: timestamp,
      runId: 'run-001',
      startedAt: timestamp,
    })

    expect(result.threadSurface.surfaceClass).toBe('shared')
    expect(result.threadSurface.visibility).toBe('dependency')
    expect(result.threadSurface.isolationLabel).toBe('NONE')
    expect(result.threadSurface.revealState).toBeNull()
    expect(result.threadSurface.allowedReadScopes).toEqual([])
    expect(result.threadSurface.allowedWriteScopes).toEqual([])
  })

  test('createChildThreadSurfaceRun adds V.1 defaults to the child surface', () => {
    const rootState = {
      version: 1 as const,
      threadSurfaces: [{
        id: 'thread-root',
        parentSurfaceId: null,
        parentAgentNodeId: null,
        depth: 0,
        surfaceLabel: 'Root thread',
        createdAt: timestamp,
        childSurfaceIds: [],
        sequenceRef: null,
        spawnedByAgentId: null,
        surfaceClass: 'shared' as const,
        visibility: 'dependency' as const,
        isolationLabel: 'NONE' as const,
        revealState: null,
        allowedReadScopes: [],
        allowedWriteScopes: [],
      }],
      runs: [{
        id: 'run-root-001',
        threadSurfaceId: 'thread-root',
        runStatus: 'running' as const,
        startedAt: timestamp,
        endedAt: null,
        parentRunId: null,
        childIndex: null,
      }],
      mergeEvents: [],
      runEvents: [],
    }

    const result = createChildThreadSurfaceRun(rootState, {
      parentSurfaceId: 'thread-root',
      parentAgentNodeId: 'step-child',
      childSurfaceId: 'thread-child',
      childSurfaceLabel: 'Child thread',
      createdAt: timestamp,
      runId: 'run-child-001',
      startedAt: timestamp,
    })

    expect(result.childSurface.surfaceClass).toBe('shared')
    expect(result.childSurface.visibility).toBe('dependency')
    expect(result.childSurface.isolationLabel).toBe('NONE')
    expect(result.childSurface.revealState).toBeNull()
    expect(result.childSurface.allowedReadScopes).toEqual([])
    expect(result.childSurface.allowedWriteScopes).toEqual([])
  })
})

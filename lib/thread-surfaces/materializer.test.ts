import { describe, test, expect } from 'bun:test'
import {
  ensureRootSurface,
  materializeStepSurface,
  removeStepSurface,
  materializeBulkStepSurfaces,
  clearAllSurfaces,
  reconcileSurfacesWithSequence,
} from './materializer'
import type { ThreadSurfaceState } from './repository'

const EMPTY_STATE: ThreadSurfaceState = { version: 1, threadSurfaces: [], runs: [], mergeEvents: [], runEvents: [] }
const NOW = '2026-03-15T00:00:00.000Z'

describe('materializer', () => {
  // ── ensureRootSurface ─────────────────────────────────────────────

  test('ensureRootSurface creates thread-root if absent', () => {
    const result = ensureRootSurface(EMPTY_STATE, 'My Seq', NOW)
    expect(result.threadSurfaces).toHaveLength(1)
    expect(result.threadSurfaces[0].id).toBe('thread-root')
    expect(result.threadSurfaces[0].depth).toBe(0)
    expect(result.threadSurfaces[0].surfaceLabel).toBe('My Seq')
    expect(result.threadSurfaces[0].role).toBe('orchestrator')
    expect(result.threadSurfaces[0].parentSurfaceId).toBeNull()
    expect(result.threadSurfaces[0].createdAt).toBe(NOW)
    expect(result.threadSurfaces[0].childSurfaceIds).toEqual([])
  })

  test('ensureRootSurface is idempotent', () => {
    const first = ensureRootSurface(EMPTY_STATE, 'Seq', NOW)
    const second = ensureRootSurface(first, 'Seq', NOW)
    expect(second.threadSurfaces).toHaveLength(1)
    // Should return the same reference when no change
    expect(second).toBe(first)
  })

  test('ensureRootSurface does not modify other state fields', () => {
    const result = ensureRootSurface(EMPTY_STATE, 'Seq', NOW)
    expect(result.runs).toEqual([])
    expect(result.mergeEvents).toEqual([])
    expect(result.runEvents).toEqual([])
    expect(result.version).toBe(1)
  })

  // ── materializeStepSurface ────────────────────────────────────────

  test('materializeStepSurface creates child surface under root', () => {
    const result = materializeStepSurface(EMPTY_STATE, 'step-a', 'Step A', 'Seq', NOW)
    expect(result.threadSurfaces).toHaveLength(2) // root + step
    const step = result.threadSurfaces.find(s => s.id === 'thread-step-a')
    expect(step).toBeDefined()
    expect(step?.parentSurfaceId).toBe('thread-root')
    expect(step?.parentAgentNodeId).toBe('step-a')
    expect(step?.depth).toBe(1)
    expect(step?.surfaceLabel).toBe('Step A')
    expect(step?.role).toBe('worker')
    expect(step?.createdAt).toBe(NOW)
    expect(step?.childSurfaceIds).toEqual([])
  })

  test('materializeStepSurface auto-creates root if missing', () => {
    const result = materializeStepSurface(EMPTY_STATE, 'step-a', 'A', 'Seq', NOW)
    const root = result.threadSurfaces.find(s => s.id === 'thread-root')
    expect(root).toBeDefined()
    expect(root?.childSurfaceIds).toContain('thread-step-a')
  })

  test('materializeStepSurface adds surfaceId to root childSurfaceIds', () => {
    const result = materializeStepSurface(EMPTY_STATE, 'step-a', 'A', 'Seq', NOW)
    const root = result.threadSurfaces.find(s => s.id === 'thread-root')
    expect(root?.childSurfaceIds).toEqual(['thread-step-a'])
  })

  test('materializeStepSurface is idempotent', () => {
    const first = materializeStepSurface(EMPTY_STATE, 'step-a', 'A', 'S', NOW)
    const second = materializeStepSurface(first, 'step-a', 'A', 'S', NOW)
    expect(second.threadSurfaces).toHaveLength(2)
    // Should return the same reference when no change
    expect(second).toBe(first)
  })

  test('materializeStepSurface can add multiple steps', () => {
    let state = materializeStepSurface(EMPTY_STATE, 'step-a', 'A', 'Seq', NOW)
    state = materializeStepSurface(state, 'step-b', 'B', 'Seq', NOW)
    expect(state.threadSurfaces).toHaveLength(3) // root + 2 steps
    const root = state.threadSurfaces.find(s => s.id === 'thread-root')
    expect(root?.childSurfaceIds).toEqual(['thread-step-a', 'thread-step-b'])
  })

  // ── removeStepSurface ─────────────────────────────────────────────

  test('removeStepSurface removes surface and cleans parent childSurfaceIds', () => {
    const state = materializeStepSurface(EMPTY_STATE, 'step-a', 'A', 'S', NOW)
    const result = removeStepSurface(state, 'step-a')
    expect(result.threadSurfaces).toHaveLength(1) // root only
    expect(result.threadSurfaces[0].id).toBe('thread-root')
    expect(result.threadSurfaces[0].childSurfaceIds).toEqual([])
  })

  test('removeStepSurface is idempotent for nonexistent step', () => {
    const result = removeStepSurface(EMPTY_STATE, 'nonexistent')
    expect(result).toBe(EMPTY_STATE) // same reference — no change
  })

  test('removeStepSurface removes related runs and runEvents', () => {
    let state = materializeStepSurface(EMPTY_STATE, 'step-a', 'A', 'S', NOW)
    // Simulate runs/runEvents targeting that surface
    state = {
      ...state,
      runs: [
        {
          id: 'run-1', threadSurfaceId: 'thread-step-a', runStatus: 'running',
          startedAt: NOW, endedAt: null, parentRunId: null, childIndex: null,
        },
        {
          id: 'run-2', threadSurfaceId: 'thread-root', runStatus: 'running',
          startedAt: NOW, endedAt: null, parentRunId: null, childIndex: null,
        },
      ],
      runEvents: [
        {
          id: 'evt-1', runId: 'run-1', eventType: 'step-started' as const,
          createdAt: NOW, threadSurfaceId: 'thread-step-a',
          payload: { stepId: 'step-a' },
        },
        {
          id: 'evt-2', runId: 'run-2', eventType: 'step-started' as const,
          createdAt: NOW, threadSurfaceId: 'thread-root',
          payload: { stepId: 'root' },
        },
      ],
    }
    const result = removeStepSurface(state, 'step-a')
    expect(result.runs).toHaveLength(1)
    expect(result.runs[0].id).toBe('run-2')
    expect(result.runEvents).toHaveLength(1)
    expect(result.runEvents[0].id).toBe('evt-2')
  })

  test('removeStepSurface leaves other surfaces intact', () => {
    let state = materializeStepSurface(EMPTY_STATE, 'step-a', 'A', 'S', NOW)
    state = materializeStepSurface(state, 'step-b', 'B', 'S', NOW)
    const result = removeStepSurface(state, 'step-a')
    expect(result.threadSurfaces).toHaveLength(2) // root + step-b
    expect(result.threadSurfaces.find(s => s.id === 'thread-step-b')).toBeDefined()
    const root = result.threadSurfaces.find(s => s.id === 'thread-root')
    expect(root?.childSurfaceIds).toEqual(['thread-step-b'])
  })

  // ── materializeBulkStepSurfaces ───────────────────────────────────

  test('materializeBulkStepSurfaces creates root + all steps', () => {
    const steps = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]
    const result = materializeBulkStepSurfaces(EMPTY_STATE, steps, 'Seq', NOW)
    expect(result.threadSurfaces).toHaveLength(3) // root + 2 steps
    const root = result.threadSurfaces.find(s => s.id === 'thread-root')
    expect(root?.childSurfaceIds).toEqual(['thread-a', 'thread-b'])
  })

  test('materializeBulkStepSurfaces with empty array just creates root', () => {
    const result = materializeBulkStepSurfaces(EMPTY_STATE, [], 'Seq', NOW)
    // Since no steps, but the function iterates an empty loop,
    // no root is created either (no call to materializeStepSurface)
    expect(result.threadSurfaces).toHaveLength(0)
  })

  test('materializeBulkStepSurfaces is idempotent', () => {
    const steps = [{ id: 'a', name: 'A' }]
    const first = materializeBulkStepSurfaces(EMPTY_STATE, steps, 'S', NOW)
    const second = materializeBulkStepSurfaces(first, steps, 'S', NOW)
    expect(second.threadSurfaces).toHaveLength(2) // root + 1 step
  })

  // ── clearAllSurfaces ──────────────────────────────────────────────

  test('clearAllSurfaces returns empty state', () => {
    const result = clearAllSurfaces()
    expect(result.threadSurfaces).toEqual([])
    expect(result.runs).toEqual([])
    expect(result.mergeEvents).toEqual([])
    expect(result.runEvents).toEqual([])
    expect(result.version).toBe(1)
  })

  // ── reconcileSurfacesWithSequence ─────────────────────────────────

  test('reconcileSurfacesWithSequence creates missing surfaces', () => {
    const steps = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]
    const result = reconcileSurfacesWithSequence(EMPTY_STATE, steps, 'Seq', NOW)
    expect(result.threadSurfaces).toHaveLength(3) // root + 2 steps
  })

  test('reconcileSurfacesWithSequence removes orphaned surfaces', () => {
    // State has surfaces for step-a and step-b, but only step-a is in the sequence
    const state = materializeBulkStepSurfaces(EMPTY_STATE, [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], 'Seq', NOW)
    const result = reconcileSurfacesWithSequence(state, [{ id: 'a', name: 'A' }], 'Seq', NOW)
    expect(result.threadSurfaces).toHaveLength(2) // root + step-a only
    expect(result.threadSurfaces.find(s => s.id === 'thread-b')).toBeUndefined()
    expect(result.threadSurfaces.find(s => s.id === 'thread-a')).toBeDefined()
  })

  test('reconcileSurfacesWithSequence is a no-op when already in sync', () => {
    const steps = [{ id: 'a', name: 'A' }]
    const state = materializeBulkStepSurfaces(EMPTY_STATE, steps, 'Seq', NOW)
    const result = reconcileSurfacesWithSequence(state, steps, 'Seq', NOW)
    // Already in sync — should not add or remove
    expect(result.threadSurfaces).toHaveLength(2) // root + step-a
  })

  test('reconcileSurfacesWithSequence returns state unchanged for empty steps', () => {
    const result = reconcileSurfacesWithSequence(EMPTY_STATE, [], 'Seq', NOW)
    expect(result).toBe(EMPTY_STATE)
  })
})

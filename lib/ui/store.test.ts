import { beforeEach, describe, expect, test } from 'bun:test'
import { useUIStore } from './store'

describe('useUIStore', () => {
  beforeEach(() => {
    useUIStore.setState(useUIStore.getInitialState(), true)
  })

  test('viewMode can switch between hierarchy and lanes', () => {
    expect(useUIStore.getState().viewMode).toBe('hierarchy')

    useUIStore.getState().setViewMode('lanes')
    expect(useUIStore.getState().viewMode).toBe('lanes')

    useUIStore.getState().setViewMode('hierarchy')
    expect(useUIStore.getState().viewMode).toBe('hierarchy')
  })

  test('selectedThreadSurfaceId persists across view changes', () => {
    useUIStore.getState().closeInspector()
    useUIStore.getState().setSelectedThreadSurfaceId('thread-synthesis')
    useUIStore.getState().setViewMode('lanes')
    useUIStore.getState().setViewMode('hierarchy')

    expect(useUIStore.getState().selectedThreadSurfaceId).toBe('thread-synthesis')
    expect(useUIStore.getState().inspectorOpen).toBeTrue()
  })

  test('opening lane focus from a hierarchy node sets synchronized top-level and lane-board focus context', () => {
    useUIStore.getState().closeInspector()
    useUIStore.getState().openLaneViewForThreadSurface('thread-research', 'run-research')

    expect(useUIStore.getState().viewMode).toBe('lanes')
    expect(useUIStore.getState().inspectorOpen).toBeTrue()
    expect(useUIStore.getState().selectedThreadSurfaceId).toBe('thread-research')
    expect(useUIStore.getState().selectedRunId).toBe('run-research')
    expect(useUIStore.getState().laneFocusThreadSurfaceId).toBe('thread-research')
    expect(useUIStore.getState().laneBoardState).toEqual({
      scrollLeft: 0,
      focusedThreadSurfaceId: 'thread-research',
      focusedRunId: 'run-research',
    })
  })

  test('hierarchy viewport state and lane board state are stored separately', () => {
    useUIStore.getState().setHierarchyViewport({ x: 120, y: 48, zoom: 0.85 })
    useUIStore.getState().setLaneBoardState({
      scrollLeft: 720,
      focusedThreadSurfaceId: 'thread-outreach',
      focusedRunId: 'run-outreach',
    })

    expect(useUIStore.getState().hierarchyViewport).toEqual({ x: 120, y: 48, zoom: 0.85 })
    expect(useUIStore.getState().laneFocusThreadSurfaceId).toBe('thread-outreach')
    expect(useUIStore.getState().laneBoardState).toEqual({
      scrollLeft: 720,
      focusedThreadSurfaceId: 'thread-outreach',
      focusedRunId: 'run-outreach',
    })
  })

  test('lane focus setters keep top-level and lane-board focus synchronized', () => {
    useUIStore.getState().openLaneViewForThreadSurface('thread-research', 'run-research')
    useUIStore.getState().setLaneFocusThreadSurfaceId('thread-synthesis')

    expect(useUIStore.getState().laneFocusThreadSurfaceId).toBe('thread-synthesis')
    expect(useUIStore.getState().laneBoardState).toEqual({
      scrollLeft: 0,
      focusedThreadSurfaceId: 'thread-synthesis',
      focusedRunId: null,
    })

    useUIStore.getState().setLaneFocusThreadSurfaceId(null)

    expect(useUIStore.getState().laneFocusThreadSurfaceId).toBeNull()
    expect(useUIStore.getState().laneBoardState).toEqual({
      scrollLeft: 0,
      focusedThreadSurfaceId: null,
      focusedRunId: null,
    })
  })
})

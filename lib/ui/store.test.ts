import { beforeEach, describe, expect, test } from 'bun:test'
import { useUIStore } from './store'

describe('useUIStore', () => {
  beforeEach(() => {
    useUIStore.setState(useUIStore.getInitialState(), true)
  })

  test('product entry starts unset until the user selects a mode', () => {
    expect(useUIStore.getState().productEntry).toBeNull()
    expect(useUIStore.getState().inspectorOpen).toBeFalse()

    useUIStore.getState().setProductEntry('thredos')
    expect(useUIStore.getState().productEntry).toBe('thredos')
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
    expect(useUIStore.getState().inspectorOpen).toBeFalse()
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

  // ── selectedNodeId and inspector side-effect ──────────────────────

  test('selectedNodeId defaults to null', () => {
    expect(useUIStore.getState().selectedNodeId).toBeNull()
  })

  test('setSelectedNodeId sets the id without side effects', () => {
    expect(useUIStore.getState().inspectorOpen).toBeFalse()

    useUIStore.getState().setSelectedNodeId('step-build')
    expect(useUIStore.getState().selectedNodeId).toBe('step-build')
    // Canvas card reads selectedNodeId directly — no inspector side-effect
    expect(useUIStore.getState().inspectorOpen).toBeFalse()
  })

  test('setSelectedNodeId with null clears the selection', () => {
    useUIStore.getState().setSelectedNodeId('step-build')
    useUIStore.getState().setSelectedNodeId(null)
    expect(useUIStore.getState().selectedNodeId).toBeNull()
  })

  // ── setSelectedThreadSurfaceId inspector side-effect ──────────────

  test('setSelectedThreadSurfaceId with null does not force-open the inspector', () => {
    useUIStore.getState().setSelectedThreadSurfaceId('thread-x')
    expect(useUIStore.getState().inspectorOpen).toBeTrue()

    useUIStore.getState().closeInspector()
    useUIStore.getState().setSelectedThreadSurfaceId(null)
    expect(useUIStore.getState().selectedThreadSurfaceId).toBeNull()
    expect(useUIStore.getState().inspectorOpen).toBeFalse()
  })

  // ── Left rail ─────────────────────────────────────────────────────

  test('leftRailOpen starts closed and toggles', () => {
    expect(useUIStore.getState().leftRailOpen).toBeFalse()

    useUIStore.getState().toggleLeftRail()
    expect(useUIStore.getState().leftRailOpen).toBeTrue()

    useUIStore.getState().toggleLeftRail()
    expect(useUIStore.getState().leftRailOpen).toBeFalse()
  })

  test('closeLeftRail forces it closed regardless of current state', () => {
    useUIStore.getState().toggleLeftRail()
    expect(useUIStore.getState().leftRailOpen).toBeTrue()

    useUIStore.getState().closeLeftRail()
    expect(useUIStore.getState().leftRailOpen).toBeFalse()

    // calling closeLeftRail when already closed is a no-op
    useUIStore.getState().closeLeftRail()
    expect(useUIStore.getState().leftRailOpen).toBeFalse()
  })

  // ── Inspector toggle ──────────────────────────────────────────────

  test('toggleInspector flips inspector open state', () => {
    expect(useUIStore.getState().inspectorOpen).toBeFalse()

    useUIStore.getState().toggleInspector()
    expect(useUIStore.getState().inspectorOpen).toBeTrue()

    useUIStore.getState().toggleInspector()
    expect(useUIStore.getState().inspectorOpen).toBeFalse()
  })

  // ── Chat toggle ───────────────────────────────────────────────────

  test('chatOpen starts closed and toggleChat flips it', () => {
    expect(useUIStore.getState().chatOpen).toBeFalse()

    useUIStore.getState().toggleChat()
    expect(useUIStore.getState().chatOpen).toBeTrue()

    useUIStore.getState().toggleChat()
    expect(useUIStore.getState().chatOpen).toBeFalse()
  })

  // ── Search query ──────────────────────────────────────────────────

  test('searchQuery starts empty and setSearchQuery updates it', () => {
    expect(useUIStore.getState().searchQuery).toBe('')

    useUIStore.getState().setSearchQuery('deploy')
    expect(useUIStore.getState().searchQuery).toBe('deploy')

    useUIStore.getState().setSearchQuery('')
    expect(useUIStore.getState().searchQuery).toBe('')
  })

  // ── Minimap toggle ────────────────────────────────────────────────

  test('minimapVisible starts true and toggleMinimap flips it', () => {
    expect(useUIStore.getState().minimapVisible).toBeTrue()

    useUIStore.getState().toggleMinimap()
    expect(useUIStore.getState().minimapVisible).toBeFalse()

    useUIStore.getState().toggleMinimap()
    expect(useUIStore.getState().minimapVisible).toBeTrue()
  })

  // ── selectedRunId ─────────────────────────────────────────────────

  test('selectedRunId starts null and setSelectedRunId updates it', () => {
    expect(useUIStore.getState().selectedRunId).toBeNull()

    useUIStore.getState().setSelectedRunId('run-alpha')
    expect(useUIStore.getState().selectedRunId).toBe('run-alpha')

    useUIStore.getState().setSelectedRunId(null)
    expect(useUIStore.getState().selectedRunId).toBeNull()
  })

  // ── Create dialog ─────────────────────────────────────────────────

  test('createDialog starts closed with default kind "step"', () => {
    expect(useUIStore.getState().createDialogOpen).toBeFalse()
    expect(useUIStore.getState().createDialogKind).toBe('step')
  })

  test('openCreateDialog opens dialog and sets the kind', () => {
    useUIStore.getState().openCreateDialog('gate')
    expect(useUIStore.getState().createDialogOpen).toBeTrue()
    expect(useUIStore.getState().createDialogKind).toBe('gate')
  })

  test('openCreateDialog can switch from gate kind to step kind', () => {
    useUIStore.getState().openCreateDialog('gate')
    useUIStore.getState().openCreateDialog('step')
    expect(useUIStore.getState().createDialogOpen).toBeTrue()
    expect(useUIStore.getState().createDialogKind).toBe('step')
  })

  test('closeCreateDialog closes the dialog but preserves the kind', () => {
    useUIStore.getState().openCreateDialog('gate')
    useUIStore.getState().closeCreateDialog()

    expect(useUIStore.getState().createDialogOpen).toBeFalse()
    // kind remains as last set value
    expect(useUIStore.getState().createDialogKind).toBe('gate')
  })

  // ── openLaneViewForThreadSurface with no runId ────────────────────

  test('openLaneViewForThreadSurface defaults runId to null when omitted', () => {
    useUIStore.getState().openLaneViewForThreadSurface('thread-solo')

    expect(useUIStore.getState().viewMode).toBe('lanes')
    expect(useUIStore.getState().selectedThreadSurfaceId).toBe('thread-solo')
    expect(useUIStore.getState().selectedRunId).toBeNull()
    expect(useUIStore.getState().laneFocusThreadSurfaceId).toBe('thread-solo')
    expect(useUIStore.getState().laneBoardState.focusedRunId).toBeNull()
    expect(useUIStore.getState().laneBoardState.focusedThreadSurfaceId).toBe('thread-solo')
  })

  // ── setLaneFocusThreadSurfaceId preserves runId when re-focusing same thread ──

  test('setLaneFocusThreadSurfaceId preserves focusedRunId when re-focusing the same thread', () => {
    useUIStore.getState().openLaneViewForThreadSurface('thread-a', 'run-a')

    // Re-focus the same thread surface — should preserve the runId
    useUIStore.getState().setLaneFocusThreadSurfaceId('thread-a')

    expect(useUIStore.getState().laneFocusThreadSurfaceId).toBe('thread-a')
    expect(useUIStore.getState().laneBoardState.focusedRunId).toBe('run-a')
  })

  // ── setProductEntry can switch between modes ──────────────────────

  test('setProductEntry switches from threados to thread-runner', () => {
    useUIStore.getState().setProductEntry('thredos')
    expect(useUIStore.getState().productEntry).toBe('thredos')

    useUIStore.getState().setProductEntry('thread-runner')
    expect(useUIStore.getState().productEntry).toBe('thread-runner')
  })

  // ── Default hierarchy viewport ────────────────────────────────────

  test('hierarchyViewport defaults to origin with zoom 1', () => {
    expect(useUIStore.getState().hierarchyViewport).toEqual({ x: 0, y: 0, zoom: 1 })
  })

  // ── Default lane board state ──────────────────────────────────────

  test('laneBoardState defaults to zero scroll and null focus', () => {
    expect(useUIStore.getState().laneBoardState).toEqual({
      scrollLeft: 0,
      focusedThreadSurfaceId: null,
      focusedRunId: null,
    })
  })
})

'use client'

import { create } from 'zustand'

export type ThreadSurfaceViewMode = 'hierarchy' | 'lanes'
export type ProductEntryMode = 'threados' | 'thread-runner'

export interface HierarchyViewportState {
  x: number
  y: number
  zoom: number
}

export interface LaneBoardState {
  scrollLeft: number
  focusedThreadSurfaceId: string | null
  focusedRunId: string | null
}

export type CreateNodeKind = 'step' | 'gate'

/** The 6 left-rail sections following thread construction flow */
export type AccordionSectionId = 'sequence' | 'phase' | 'node' | 'agent' | 'gate' | 'run'

export interface NavFrame {
  threadSurfaceId: string
  surfaceLabel: string
  depth: number
}

interface UIStore {
  productEntry: ProductEntryMode | null
  setProductEntry: (entry: ProductEntryMode) => void
  selectedNodeId: string | null
  setSelectedNodeId: (id: string | null) => void
  leftRailOpen: boolean
  toggleLeftRail: () => void
  closeLeftRail: () => void
  inspectorOpen: boolean
  toggleInspector: () => void
  closeInspector: () => void
  chatOpen: boolean
  toggleChat: () => void
  searchQuery: string
  setSearchQuery: (q: string) => void
  minimapVisible: boolean
  toggleMinimap: () => void
  viewMode: ThreadSurfaceViewMode
  setViewMode: (mode: ThreadSurfaceViewMode) => void
  selectedThreadSurfaceId: string | null
  setSelectedThreadSurfaceId: (id: string | null) => void
  selectedRunId: string | null
  setSelectedRunId: (id: string | null) => void
  /** Phase-scoped navigation — scopes NODE/AGENT/GATE to selected phase */
  selectedPhaseId: string | null
  setSelectedPhaseId: (id: string | null) => void
  /** Selects a phase and auto-opens the node section for it */
  selectPhaseAndFocus: (phaseId: string) => void
  hierarchyViewport: HierarchyViewportState
  setHierarchyViewport: (viewport: HierarchyViewportState) => void
  laneFocusThreadSurfaceId: string | null
  setLaneFocusThreadSurfaceId: (id: string | null) => void
  laneBoardState: LaneBoardState
  setLaneBoardState: (state: LaneBoardState) => void
  openLaneViewForThreadSurface: (threadSurfaceId: string, runId?: string | null) => void
  chatPosition: { x: number; y: number }
  setChatPosition: (pos: { x: number; y: number }) => void
  chatSize: { width: number; height: number }
  setChatSize: (size: { width: number; height: number }) => void
  createDialogOpen: boolean
  createDialogKind: CreateNodeKind
  openCreateDialog: (kind: CreateNodeKind) => void
  closeCreateDialog: () => void
  activeAccordionSections: string[]
  setActiveAccordionSections: (sections: string[]) => void
  expandAccordionSection: (section: string) => void
  collapseAccordionSection: (section: string) => void
  navigationStack: NavFrame[]
  portalDirection: 'forward' | 'back' | null
  pushDepth: (frame: NavFrame) => void
  popDepth: () => void
  jumpToDepth: (index: number) => void
  resetNavigation: (root: NavFrame) => void
  currentDepthSurfaceId: string | null
  currentDepthLevel: number
  pathSegments: Array<{ id: string; label: string; depth: number }>
  expandedChildSurfaceIds: string[]
  toggleChildSurfaceExpanded: (surfaceId: string) => void
  collapseAllChildSurfaces: () => void
}

const defaultHierarchyViewport: HierarchyViewportState = {
  x: 0,
  y: 0,
  zoom: 1,
}

const defaultLaneBoardState: LaneBoardState = {
  scrollLeft: 0,
  focusedThreadSurfaceId: null,
  focusedRunId: null,
}

export const useUIStore = create<UIStore>((set) => ({
  productEntry: null,
  setProductEntry: (entry) => set({ productEntry: entry }),
  selectedNodeId: null,
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),
  leftRailOpen: false,
  toggleLeftRail: () => set((s) => ({ leftRailOpen: !s.leftRailOpen })),
  closeLeftRail: () => set({ leftRailOpen: false }),
  inspectorOpen: false,
  toggleInspector: () => set((s) => ({ inspectorOpen: !s.inspectorOpen })),
  closeInspector: () => set({ inspectorOpen: false }),
  chatOpen: false,
  toggleChat: () => set((s) => ({ chatOpen: !s.chatOpen })),
  searchQuery: '',
  setSearchQuery: (q) => set({ searchQuery: q }),
  minimapVisible: true,
  toggleMinimap: () => set((s) => ({ minimapVisible: !s.minimapVisible })),
  viewMode: 'hierarchy',
  setViewMode: (mode) => set({ viewMode: mode }),
  selectedThreadSurfaceId: null,
  setSelectedThreadSurfaceId: (id) =>
    set({
      selectedThreadSurfaceId: id,
      ...(id != null ? { inspectorOpen: true } : {}),
    }),
  selectedRunId: null,
  setSelectedRunId: (id) => set({ selectedRunId: id }),
  selectedPhaseId: null,
  setSelectedPhaseId: (id) => set({ selectedPhaseId: id }),
  selectPhaseAndFocus: (phaseId) =>
    set((s) => ({
      selectedPhaseId: phaseId,
      activeAccordionSections: s.activeAccordionSections.includes('node')
        ? s.activeAccordionSections
        : [...s.activeAccordionSections, 'node'],
    })),
  hierarchyViewport: defaultHierarchyViewport,
  setHierarchyViewport: (viewport) => set({ hierarchyViewport: viewport }),
  laneFocusThreadSurfaceId: null,
  setLaneFocusThreadSurfaceId: (id) =>
    set((state) => ({
      laneFocusThreadSurfaceId: id,
      laneBoardState: {
        ...state.laneBoardState,
        focusedThreadSurfaceId: id,
        focusedRunId:
          id == null || id !== state.laneBoardState.focusedThreadSurfaceId
            ? null
            : state.laneBoardState.focusedRunId,
      },
    })),
  laneBoardState: defaultLaneBoardState,
  setLaneBoardState: (state) =>
    set({
      laneFocusThreadSurfaceId: state.focusedThreadSurfaceId,
      laneBoardState: state,
    }),
  openLaneViewForThreadSurface: (threadSurfaceId, runId = null) =>
    set((state) => ({
      viewMode: 'lanes',
      selectedThreadSurfaceId: threadSurfaceId,
      selectedRunId: runId,
      laneFocusThreadSurfaceId: threadSurfaceId,
      laneBoardState: {
        ...state.laneBoardState,
        focusedThreadSurfaceId: threadSurfaceId,
        focusedRunId: runId,
      },
      activeAccordionSections: state.activeAccordionSections.includes('run')
        ? state.activeAccordionSections
        : [...state.activeAccordionSections, 'run'],
    })),
  chatPosition: { x: 0, y: 0 },
  setChatPosition: (pos) => set({ chatPosition: pos }),
  chatSize: { width: 400, height: 500 },
  setChatSize: (size) => set({ chatSize: size }),
  createDialogOpen: false,
  createDialogKind: 'step',
  openCreateDialog: (kind) => set({ createDialogOpen: true, createDialogKind: kind }),
  closeCreateDialog: () => set({ createDialogOpen: false }),
  activeAccordionSections: ['sequence'],
  setActiveAccordionSections: (sections) => set({ activeAccordionSections: sections }),
  expandAccordionSection: (section) => set((s) => ({
    activeAccordionSections: s.activeAccordionSections.includes(section)
      ? s.activeAccordionSections
      : [...s.activeAccordionSections, section],
  })),
  collapseAccordionSection: (section) => set((s) => ({
    activeAccordionSections: s.activeAccordionSections.filter(id => id !== section),
  })),
  navigationStack: [],
  portalDirection: null,
  pushDepth: (frame) => set((s) => ({
    navigationStack: [...s.navigationStack, frame],
    portalDirection: 'forward' as const,
    selectedThreadSurfaceId: frame.threadSurfaceId,
  })),
  popDepth: () => set((s) => {
    if (s.navigationStack.length <= 1) return {}
    const nextStack = s.navigationStack.slice(0, -1)
    const top = nextStack[nextStack.length - 1]
    return {
      navigationStack: nextStack,
      portalDirection: 'back' as const,
      selectedThreadSurfaceId: top?.threadSurfaceId ?? null,
    }
  }),
  jumpToDepth: (index) => set((s) => {
    if (index < 0 || index >= s.navigationStack.length) return {}
    const nextStack = s.navigationStack.slice(0, index + 1)
    const top = nextStack[nextStack.length - 1]
    return {
      navigationStack: nextStack,
      portalDirection: 'back' as const,
      selectedThreadSurfaceId: top?.threadSurfaceId ?? null,
    }
  }),
  resetNavigation: (root) => set({
    navigationStack: [root],
    portalDirection: null,
  }),
  currentDepthSurfaceId: null,
  currentDepthLevel: 0,
  pathSegments: [],
  expandedChildSurfaceIds: [],
  toggleChildSurfaceExpanded: (surfaceId) => set((s) => ({
    expandedChildSurfaceIds: s.expandedChildSurfaceIds.includes(surfaceId)
      ? s.expandedChildSurfaceIds.filter(id => id !== surfaceId)
      : [...s.expandedChildSurfaceIds, surfaceId],
  })),
  collapseAllChildSurfaces: () => set({ expandedChildSurfaceIds: [] }),
}))

export const selectCurrentDepthSurfaceId = (s: UIStore): string | null => {
  const stack = s.navigationStack
  return stack.length > 0 ? stack[stack.length - 1].threadSurfaceId : null
}

export const selectCurrentDepthLevel = (s: UIStore): number => {
  const stack = s.navigationStack
  return stack.length > 0 ? stack[stack.length - 1].depth : 0
}

export const selectPathSegments = (s: UIStore): Array<{ id: string; label: string; depth: number }> => {
  return s.navigationStack.map(f => ({ id: f.threadSurfaceId, label: f.surfaceLabel, depth: f.depth }))
}

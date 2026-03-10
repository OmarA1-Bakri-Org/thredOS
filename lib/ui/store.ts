'use client'

import { create } from 'zustand'

export type ThreadSurfaceViewMode = 'hierarchy' | 'lanes' | 'layers'
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

interface UIStore {
  productEntry: ProductEntryMode
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
  hierarchyViewport: HierarchyViewportState
  setHierarchyViewport: (viewport: HierarchyViewportState) => void
  laneFocusThreadSurfaceId: string | null
  setLaneFocusThreadSurfaceId: (id: string | null) => void
  laneBoardState: LaneBoardState
  setLaneBoardState: (state: LaneBoardState) => void
  openLaneViewForThreadSurface: (threadSurfaceId: string, runId?: string | null) => void
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
  productEntry: 'threados',
  setProductEntry: (entry) => set({ productEntry: entry }),
  selectedNodeId: null,
  setSelectedNodeId: (id) => set({ selectedNodeId: id, ...(id != null ? { inspectorOpen: true } : {}) }),
  leftRailOpen: false,
  toggleLeftRail: () => set((s) => ({ leftRailOpen: !s.leftRailOpen })),
  closeLeftRail: () => set({ leftRailOpen: false }),
  inspectorOpen: true,
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
      inspectorOpen: true,
      selectedThreadSurfaceId: threadSurfaceId,
      selectedRunId: runId,
      laneFocusThreadSurfaceId: threadSurfaceId,
      laneBoardState: {
        ...state.laneBoardState,
        focusedThreadSurfaceId: threadSurfaceId,
        focusedRunId: runId,
      },
    })),
}))

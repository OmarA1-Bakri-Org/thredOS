import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SequenceStatus } from '@/app/api/status/route'
import type { MergeEvent, RunScope, ThreadSurface } from '@/lib/thread-surfaces/types'
import type { ProductEntryMode, ThreadSurfaceViewMode } from '@/lib/ui/store'

type MultiThreadFixture = {
  threadSurfaces: ThreadSurface[]
  runs: RunScope[]
  mergeEvents: MergeEvent[]
}

const multiThreadState = JSON.parse(
  readFileSync(new URL('../../test/fixtures/thread-surfaces/multi-thread-state.json', import.meta.url), 'utf8'),
) as MultiThreadFixture

const status: SequenceStatus = {
  name: 'Content Creator',
  version: '1.0',
  thread_type: undefined,
  steps: [
    {
      id: 'draft_linkedin',
      name: 'Draft LinkedIn',
      type: 'p',
      status: 'RUNNING',
      model: 'claude-code',
      dependsOn: ['research'],
      processIndex: 1,
      groupId: 'publishing',
      fusionCandidates: false,
      fusionSynth: false,
    },
  ],
  gates: [],
  summary: {
    total: 1,
    ready: 0,
    running: 1,
    done: 0,
    failed: 0,
    blocked: 0,
    needsReview: 0,
  },
}

mock.module('@/lib/ui/api', () => ({
  useStatus: () => ({ data: status, isLoading: false }),
  useThreadSurfaces: () => ({ data: multiThreadState.threadSurfaces }),
  useThreadRuns: () => ({ data: multiThreadState.runs }),
  useThreadMerges: () => ({ data: multiThreadState.mergeEvents }),
  useRunStep: () => ({ mutate: () => {}, isPending: false, error: null }),
  useRunRunnable: () => ({ mutate: () => {}, isPending: false, error: null }),
  useStopStep: () => ({ mutate: () => {}, isPending: false, error: null }),
  useRestartStep: () => ({ mutate: () => {}, isPending: false, error: null }),
  useApproveGate: () => ({ mutate: () => {}, isPending: false, error: null }),
  useBlockGate: () => ({ mutate: () => {}, isPending: false, error: null }),
  useRemoveGate: () => ({ mutate: () => {}, isPending: false, error: null }),
  useEditStep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, error: null }),
  useRemoveStep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, error: null }),
  useCloneStep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, error: null }),
  useAddDep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, error: null }),
  useRemoveDep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, error: null }),
  useAgentPerformance: () => ({ data: null, isLoading: false }),
  useGateMetrics: () => ({ data: null, isLoading: false }),
  useAddStep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, error: null }),
  useInsertGate: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, error: null }),
  useListPacks: () => ({ data: [], isLoading: false }),
  useCreatePack: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  usePromotePack: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useBuilderProfile: () => ({ data: null, isLoading: false }),
  useThreadRunnerEligibility: () => ({ data: { eligible: false, requirements: [] }, isLoading: false }),
  useOptimizeWorkflow: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useResetSequence: () => ({ mutate: () => {}, isPending: false }),
  useListRaces: () => ({ data: [], isLoading: false }),
  useRaceResults: () => ({ data: null, isLoading: false }),
  useEnrollRace: () => ({ mutate: () => {}, isPending: false }),
  useRecordRun: () => ({ mutate: () => {}, isPending: false }),
  useTraces: () => ({ data: [], isLoading: false }),
  useApprovals: () => ({ data: [], isLoading: false }),
  useRequestApproval: () => ({ mutate: () => {}, mutateAsync: async () => ({}) }),
  useResolveApproval: () => ({ mutate: () => {}, mutateAsync: async () => ({}) }),
  useRevealSurface: () => ({ mutate: () => {}, mutateAsync: async () => ({}) }),
  useExportBundle: () => ({ mutate: () => {}, mutateAsync: async () => ({}) }),
  useSurfaceAccess: () => ({ data: null, isLoading: false }),
}))

const uiState: {
  productEntry: ProductEntryMode | null
  selectedNodeId: string | null
  leftRailOpen: boolean
  inspectorOpen: boolean
  chatOpen: boolean
  searchQuery: string
  minimapVisible: boolean
  viewMode: ThreadSurfaceViewMode
  selectedThreadSurfaceId: string | null
  selectedRunId: string | null
  hierarchyViewport: { x: number; y: number; zoom: number }
  laneFocusThreadSurfaceId: string | null
  laneBoardState: {
    scrollLeft: number
    focusedThreadSurfaceId: string | null
    focusedRunId: string | null
  }
} = {
  productEntry: 'thredos',
  selectedNodeId: 'draft_linkedin' as string | null,
  leftRailOpen: false,
  inspectorOpen: true,
  chatOpen: false,
  searchQuery: '',
  minimapVisible: true,
  viewMode: 'hierarchy' as const,
  selectedThreadSurfaceId: 'thread-synthesis' as string | null,
  selectedRunId: 'run-synthesis' as string | null,
  hierarchyViewport: { x: 0, y: 0, zoom: 1 },
  laneFocusThreadSurfaceId: null as string | null,
  laneBoardState: {
    scrollLeft: 0,
    focusedThreadSurfaceId: null as string | null,
    focusedRunId: null as string | null,
  },
}

const applyState = (patch: Partial<typeof uiState>) => {
  Object.assign(uiState, patch)
}

const useUIStoreMock = Object.assign(
  <T,>(selector: (state: typeof uiState & Record<string, unknown>) => T) =>
    selector({
      ...uiState,
      setProductEntry: () => {},
      setSelectedNodeId: (id: string | null) => applyState({ selectedNodeId: id }),
      toggleLeftRail: () => applyState({ leftRailOpen: !uiState.leftRailOpen }),
      closeLeftRail: () => applyState({ leftRailOpen: false }),
      toggleInspector: () => applyState({ inspectorOpen: !uiState.inspectorOpen }),
      closeInspector: () => applyState({ inspectorOpen: false }),
      toggleChat: () => applyState({ chatOpen: !uiState.chatOpen }),
      setSearchQuery: (q: string) => applyState({ searchQuery: q }),
      toggleMinimap: () => applyState({ minimapVisible: !uiState.minimapVisible }),
      setViewMode: (mode: 'hierarchy' | 'lanes') => applyState({ viewMode: mode }),
      setSelectedThreadSurfaceId: (id: string | null) => applyState({ selectedThreadSurfaceId: id }),
      setSelectedRunId: (id: string | null) => applyState({ selectedRunId: id }),
      setHierarchyViewport: (viewport: typeof uiState.hierarchyViewport) => applyState({ hierarchyViewport: viewport }),
      setLaneFocusThreadSurfaceId: (id: string | null) => applyState({ laneFocusThreadSurfaceId: id }),
      setLaneBoardState: (state: typeof uiState.laneBoardState) => applyState({ laneBoardState: state }),
      openLaneViewForThreadSurface: (threadSurfaceId: string, runId: string | null = null) =>
        applyState({
          viewMode: 'lanes',
          inspectorOpen: true,
          selectedThreadSurfaceId: threadSurfaceId,
          selectedRunId: runId,
          laneFocusThreadSurfaceId: threadSurfaceId,
          laneBoardState: {
            ...uiState.laneBoardState,
            focusedThreadSurfaceId: threadSurfaceId,
            focusedRunId: runId,
          },
        }),
    }),
  {
    setState: applyState,
    getState: () => uiState,
  },
)

mock.module('@/lib/ui/store', () => ({
  useUIStore: useUIStoreMock,
}))

const { StepInspector } = await import('./StepInspector')

afterEach(() => {
  mock.restore()
})

describe('StepInspector', () => {
  beforeEach(() => {
    useUIStoreMock.setState({
      productEntry: 'thredos',
      selectedNodeId: 'draft_linkedin',
      leftRailOpen: false,
      selectedThreadSurfaceId: 'thread-synthesis',
      selectedRunId: 'run-synthesis',
      inspectorOpen: true,
      chatOpen: false,
      searchQuery: '',
      minimapVisible: true,
      viewMode: 'hierarchy',
      hierarchyViewport: { x: 0, y: 0, zoom: 1 },
      laneFocusThreadSurfaceId: null,
      laneBoardState: {
        scrollLeft: 0,
        focusedThreadSurfaceId: null,
        focusedRunId: null,
      },
    })
  })

  test('promotes thread, run, provenance, and workflow detail into the inspector when a workflow step is selected', () => {
    const markup = renderToStaticMarkup(<StepInspector />)

    expect(markup).toContain('data-testid="step-inspector-thread-context"')
    expect(markup).toContain('data-testid="step-inspector-thread-provenance"')
    expect(markup).toContain('data-testid="step-inspector-run-notes"')
    expect(markup).toContain('data-testid="step-inspector-run-discussion"')
    expect(markup).toContain('data-testid="step-inspector-workflow-detail"')
    expect(markup).toContain('Synthesis')
    expect(markup).toContain('run-synthesis')
    expect(markup).toContain('Draft LinkedIn')
    expect(markup).toContain('Synthesis is preparing the review packet.')
    expect(markup).toContain('Synthesis discussion context.')
    expect(markup).toContain('Step context')
    expect(markup).toContain('Blueprint')
  })
})

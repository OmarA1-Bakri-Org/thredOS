import { describe, expect, test, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

const uiState = {
  selectedThreadSurfaceId: null as string | null,
  setSelectedThreadSurfaceId: (_id: string | null) => {},
}

mock.module('@/lib/ui/store', () => ({
  useUIStore: Object.assign(
    (selector: (s: typeof uiState) => unknown) => selector(uiState),
    {
      setState: (patch: Partial<typeof uiState>) => Object.assign(uiState, patch),
      getState: () => uiState,
    },
  ),
}))

mock.module('@/lib/ui/api', () => ({
  useThreadSurfaces: () => ({
    data: [
      { id: 'thread-master', surfaceLabel: 'Master Thread', depth: 0, role: 'orchestrator', childSurfaceIds: ['thread-child'] },
      { id: 'thread-child', surfaceLabel: 'Child Thread', depth: 1, role: 'worker', childSurfaceIds: [] },
    ],
  }),
  useAgentPerformance: () => ({ data: null, isLoading: false }),
  useGateMetrics: () => ({ data: null, isLoading: false }),
  useListPacks: () => ({ data: [], isLoading: false }),
  useCreatePack: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  usePromotePack: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useBuilderProfile: () => ({ data: null, isLoading: false }),
  useThreadRunnerEligibility: () => ({ data: { eligible: false, requirements: [] }, isLoading: false }),
  useOptimizeWorkflow: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
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

const { ThreadNavigatorContent } = await import('./ThreadNavigatorContent')

describe('ThreadNavigatorContent', () => {
  test('renders thread surface list with labels and metadata', () => {
    const markup = renderToStaticMarkup(<ThreadNavigatorContent />)
    expect(markup).toContain('Master Thread')
    expect(markup).toContain('Child Thread')
    expect(markup).toContain('depth 0')
    expect(markup).toContain('orchestrator')
  })
})

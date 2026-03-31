import { describe, expect, test, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

const storeState = { selectedNodeId: null as string | null }

mock.module('@/lib/ui/store', () => ({
  useUIStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
}))

const noop = () => {}
const noopMutation = () => ({ mutate: noop, mutateAsync: async () => ({}), isPending: false, error: null })

mock.module('@/lib/ui/api', () => ({
  postJson: async () => ({}),
  unwrapThreadSurfacesResponse: (r: unknown) => r,
  unwrapThreadRunsResponse: (r: unknown) => r,
  unwrapThreadMergesResponse: (r: unknown) => r,
  useSequence: () => ({ data: null, isLoading: false }),
  useStatus: () => ({ data: null, isLoading: false }),
  useThreadSurfaces: () => ({ data: null }),
  useThreadRuns: () => ({ data: null }),
  useThreadMerges: () => ({ data: null }),
  useRunStep: noopMutation,
  useRunRunnable: noopMutation,
  useStopStep: noopMutation,
  useRestartStep: noopMutation,
  useApproveGate: noopMutation,
  useBlockGate: noopMutation,
  useAddStep: noopMutation,
  useEditStep: noopMutation,
  useRemoveStep: noopMutation,
  useCloneStep: noopMutation,
  useInsertGate: noopMutation,
  useAddDep: noopMutation,
  useRemoveDep: noopMutation,
  useAgentPerformance: () => ({ data: null, isLoading: false }),
  useGateMetrics: () => ({ data: null, isLoading: false }),
  useListPacks: () => ({ data: [], isLoading: false }),
  useCreatePack: noopMutation,
  usePromotePack: noopMutation,
  useBuilderProfile: () => ({ data: null, isLoading: false }),
  useThreadRunnerEligibility: () => ({ data: { eligible: false, requirements: [] }, isLoading: false }),
  useOptimizeWorkflow: noopMutation,
  useListRaces: () => ({ data: [], isLoading: false }),
  useRaceResults: () => ({ data: null, isLoading: false }),
  useEnrollRace: noopMutation,
  useRecordRun: noopMutation,
  useTraces: () => ({ data: [], isLoading: false }),
  useApprovals: () => ({ data: [], isLoading: false }),
  useRequestApproval: noopMutation,
  useResolveApproval: noopMutation,
  useRevealSurface: noopMutation,
  useExportBundle: noopMutation,
  useSurfaceAccess: () => ({ data: null, isLoading: false }),
}))

const { StepDetailContent } = await import('./StepDetailContent')

describe('StepDetailContent', () => {
  test('renders empty state when no node is selected', () => {
    const markup = renderToStaticMarkup(<StepDetailContent />)
    expect(markup).toContain('Select a step or gate')
  })
})

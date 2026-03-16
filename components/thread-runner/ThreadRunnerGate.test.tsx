import { describe, expect, test, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

// ---------------------------------------------------------------------------
// Mutable eligibility state — tests reassign before rendering.
// ---------------------------------------------------------------------------

const eligibilityState = {
  data: {
    eligible: false,
    requirements: [
      {
        key: 'verified-identity',
        label: 'Verified Identity',
        description: 'A verified ThreadOS identity linked to your account.',
        met: false,
      },
      {
        key: 'vm-access',
        label: 'VM Access',
        description: 'Managed VM runtime for sandboxed execution environments.',
        met: false,
      },
      {
        key: 'active-subscription',
        label: 'Active Subscription',
        description: 'An active paid subscription to the Thread Runner tier.',
        met: false,
      },
    ],
  },
  isLoading: false,
}

// ---------------------------------------------------------------------------
// Mock @/lib/ui/api — must provide ALL exports (Bun replaces the entire module).
// ---------------------------------------------------------------------------

mock.module('@/lib/ui/api', () => ({
  useStatus: () => ({ data: { steps: [], gates: [], summary: {} }, isLoading: false }),
  useSequence: () => ({ data: null }),
  useThreadSurfaces: () => ({ data: [] }),
  useThreadRuns: () => ({ data: [] }),
  useThreadMerges: () => ({ data: [] }),
  useRunStep: () => ({ mutate: () => {}, isPending: false, error: null }),
  useRunRunnable: () => ({ mutate: () => {}, isPending: false }),
  useStopStep: () => ({ mutate: () => {}, isPending: false, error: null }),
  useRestartStep: () => ({ mutate: () => {}, isPending: false, error: null }),
  useApproveGate: () => ({ mutate: () => {}, isPending: false, error: null }),
  useUpdateGate: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, error: null }),
  useBlockGate: () => ({ mutate: () => {}, isPending: false, error: null }),
  useEditStep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, error: null }),
  useRemoveStep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, error: null }),
  useRemoveGate: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, error: null }),
  useCloneStep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, error: null }),
  useAddStep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useInsertGate: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useAddDep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useRemoveDep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useResetSequence: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useAgentProfile: () => ({ data: null, isLoading: false }),
  useListAgents: () => ({ data: [], isLoading: false }),
  useRegisterAgent: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useAssignAgent: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useThreadSurfaceSkills: () => ({ data: null, isLoading: false }),
  useRenameSequence: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useSetThreadType: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useApplyTemplate: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useAgentPerformance: () => ({ data: null, isLoading: false }),
  useGateMetrics: () => ({ data: null, isLoading: false }),
  useListPacks: () => ({ data: [], isLoading: false }),
  useCreatePack: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  usePromotePack: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useBuilderProfile: () => ({ data: null, isLoading: false }),
  useThreadRunnerEligibility: () => ({ ...eligibilityState }),
  useOptimizeWorkflow: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useListRaces: () => ({ data: [], isLoading: false }),
  useRaceResults: () => ({ data: null, isLoading: false }),
  useEnrollRace: () => ({ mutate: () => {}, isPending: false }),
  useRecordRun: () => ({ mutate: () => {}, isPending: false }),
  postJson: async () => ({}),
  unwrapThreadSurfacesResponse: (r: unknown) => r,
  unwrapThreadRunsResponse: (r: unknown) => r,
  unwrapThreadMergesResponse: (r: unknown) => r,
}))

// ---------------------------------------------------------------------------
// Dynamic import — after all mock.module() calls.
// ---------------------------------------------------------------------------

const { ThreadRunnerGate } = await import('./ThreadRunnerGate')

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ThreadRunnerGate', () => {
  test('renders the gate panel with trophy icon and title', () => {
    const markup = renderToStaticMarkup(<ThreadRunnerGate />)

    expect(markup).toContain('data-testid="thread-runner-gate"')
    expect(markup).toContain('Thread Runner')
  })

  test('renders all three requirement cards', () => {
    const markup = renderToStaticMarkup(<ThreadRunnerGate />)

    expect(markup).toContain('data-testid="thread-runner-requirements"')
    expect(markup).toContain('data-testid="requirement-verified-identity"')
    expect(markup).toContain('data-testid="requirement-vm-access"')
    expect(markup).toContain('data-testid="requirement-active-subscription"')
  })

  test('all requirements show locked status by default', () => {
    const markup = renderToStaticMarkup(<ThreadRunnerGate />)

    // Count locked badges — all three should be locked
    const lockedCount = (markup.match(/Locked/g) || []).length
    expect(lockedCount).toBeGreaterThanOrEqual(3)
  })

  test('renders disabled Check Eligibility button', () => {
    const markup = renderToStaticMarkup(<ThreadRunnerGate />)

    expect(markup).toContain('data-testid="check-eligibility-btn"')
    expect(markup).toContain('disabled')
    expect(markup).toContain('Check Eligibility')
  })

  test('displays requirement descriptions', () => {
    const markup = renderToStaticMarkup(<ThreadRunnerGate />)

    expect(markup).toContain('verified ThreadOS identity')
    expect(markup).toContain('sandboxed execution')
    expect(markup).toContain('paid subscription')
  })
})

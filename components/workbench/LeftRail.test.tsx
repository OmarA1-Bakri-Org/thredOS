import { describe, expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

const uiState = {
  selectedThreadSurfaceId: 'thread-synthesis' as string | null,
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
      {
        id: 'thread-master',
        surfaceLabel: 'Master Thread',
        depth: 0,
        role: 'orchestrator',
        childSurfaceIds: ['thread-research', 'thread-synthesis'],
      },
      {
        id: 'thread-synthesis',
        surfaceLabel: 'Synthesis Thread',
        depth: 1,
        role: 'synth',
        childSurfaceIds: [],
      },
    ],
  }),
  useStatus: () => ({ data: null, isLoading: false }),
  useRunRunnable: () => ({ mutate: () => {}, isPending: false }),
  useRunStep: () => ({ mutate: () => {}, isPending: false, error: null }),
  useStopStep: () => ({ mutate: () => {}, isPending: false, error: null }),
  useRestartStep: () => ({ mutate: () => {}, isPending: false, error: null }),
  useApproveGate: () => ({ mutate: () => {}, isPending: false, error: null }),
  useBlockGate: () => ({ mutate: () => {}, isPending: false, error: null }),
  useThreadRuns: () => ({ data: [] }),
  useThreadMerges: () => ({ data: [] }),
  useEditStep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, error: null }),
  useRemoveStep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, error: null }),
  useCloneStep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, error: null }),
  useAddDep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, error: null }),
  useRemoveDep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, error: null }),
  useAddStep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, error: null }),
  useInsertGate: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, error: null }),
  useThreadSurfaceSkills: () => ({ data: [{ id: 'search', label: 'Search', inherited: false }] }),
}))

const { LeftRail } = await import('./LeftRail')

describe('LeftRail', () => {
  test('renders navigator surfaces with thread metadata', () => {
    const markup = renderToStaticMarkup(<LeftRail />)

    expect(markup).toContain('Thread Navigator')
    expect(markup).toContain('Master Thread')
    expect(markup).toContain('Synthesis Thread')
    expect(markup).toContain('depth 0')
    expect(markup).toContain('orchestrator')
    expect(markup).toContain('depth 1')
    expect(markup).toContain('synth')
  })

  test('does not render Thread Runner locked section in footer', () => {
    const markup = renderToStaticMarkup(<LeftRail />)

    expect(markup).not.toContain('data-testid="left-rail-thread-runner"')
    expect(markup).not.toContain('Locked')
  })
})

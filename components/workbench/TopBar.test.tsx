import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { useUIStore } from '@/lib/ui/store'

mock.module('next-themes', () => ({
  useTheme: () => ({
    theme: 'dark',
    setTheme: () => {},
  }),
}))

mock.module('@/lib/ui/api', () => ({
  useStatus: () => ({
    data: {
      name: 'Content Creator',
      summary: {
        ready: 4,
        running: 1,
        done: 6,
        failed: 0,
      },
    },
  }),
  useRunRunnable: () => ({
    mutate: () => {},
    isPending: false,
  }),
  useDesktopEntitlement: () => ({
    data: {
      effectiveStatus: 'active',
      isUsable: true,
      state: {
        status: 'active',
        plan: 'desktop-public-beta',
        customerEmail: 'local@thredos',
        activatedAt: null,
        lastValidatedAt: null,
        expiresAt: null,
        graceUntil: null,
        activationSource: 'development',
      },
    },
  }),
  useResetSequence: () => ({
    mutate: () => {},
    isPending: false,
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

const { TopBar } = await import('./TopBar')

describe('TopBar', () => {
  beforeEach(() => {
    useUIStore.setState({
      productEntry: 'thredos',
      viewMode: 'hierarchy',
      searchQuery: '',
      leftRailOpen: false,
      inspectorOpen: true,
      chatOpen: false,
    })
  })

  test('renders grouped workbench clusters instead of one flat control row', () => {
    const markup = renderToStaticMarkup(<TopBar />)

    expect(markup).toContain('data-workbench-cluster="navigation"')
    expect(markup).toContain('data-workbench-cluster="view-mode"')
    expect(markup).toContain('data-workbench-cluster="command-search"')
    expect(markup).toContain('data-workbench-cluster="primary-actions"')
    expect(markup).toContain('data-workbench-cluster="utility-status"')
  })

  test('keeps the workbench scoped to thredOS only', () => {
    const markup = renderToStaticMarkup(<TopBar />)

    expect(markup).not.toContain('Thread Runner')
    expect(markup).toContain('Home')
  })

  test('compresses utility status into a single status summary and smaller-screen fallback pill', () => {
    const markup = renderToStaticMarkup(<TopBar />)

    expect(markup).toContain('data-testid="topbar-status-summary"')
    expect(markup).toContain('Ready 4 · Active 1 · Completed 6 · Failed 0')
    expect(markup).toContain('xl:hidden')
    expect(markup).not.toContain('Thread Chat')
  })
})

import { describe, test, expect, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('@/lib/ui/api', () => ({
  useStatus: () => ({
    data: {
      name: 'Test Sequence',
      steps: [],
      gates: [],
      summary: { ready: 2, running: 1, done: 3, failed: 0 },
    },
    isLoading: false,
  }),
  useSequence: () => ({ data: null }),
  useThreadSurfaces: () => ({ data: [] }),
  useThreadRuns: () => ({ data: [] }),
  useThreadMerges: () => ({ data: [] }),
  useRunStep: () => ({ mutate: () => {}, isPending: false, error: null }),
  useRunRunnable: () => ({ mutate: () => {}, isPending: false }),
  useStopStep: () => ({ mutate: () => {}, isPending: false, error: null }),
  useRestartStep: () => ({ mutate: () => {}, isPending: false, error: null }),
  useApproveGate: () => ({ mutate: () => {}, isPending: false, error: null }),
  useBlockGate: () => ({ mutate: () => {}, isPending: false, error: null }),
  useEditStep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, error: null }),
  useRemoveStep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, error: null }),
  useCloneStep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, error: null }),
  useAddStep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useInsertGate: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useAddDep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useRemoveDep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
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
}))

mock.module('next-themes', () => ({
  useTheme: () => ({ theme: 'dark', setTheme: () => {} }),
}))

const { Toolbar } = await import('./Toolbar')

describe('Toolbar', () => {
  test('renders ThreadOS brand', () => {
    const markup = renderToStaticMarkup(<Toolbar />)
    expect(markup).toContain('ThreadOS')
  })

  test('renders sequence name', () => {
    const markup = renderToStaticMarkup(<Toolbar />)
    expect(markup).toContain('Test Sequence')
  })

  test('renders Run Runnable button', () => {
    const markup = renderToStaticMarkup(<Toolbar />)
    expect(markup).toContain('Run Runnable')
  })

  test('renders search input', () => {
    const markup = renderToStaticMarkup(<Toolbar />)
    expect(markup).toContain('Search steps...')
  })

  test('renders Minimap button', () => {
    const markup = renderToStaticMarkup(<Toolbar />)
    expect(markup).toContain('Minimap')
  })

  test('renders Inspector button', () => {
    const markup = renderToStaticMarkup(<Toolbar />)
    expect(markup).toContain('Inspector')
  })

  test('renders Chat button', () => {
    const markup = renderToStaticMarkup(<Toolbar />)
    expect(markup).toContain('Chat')
  })

  test('renders status summary', () => {
    const markup = renderToStaticMarkup(<Toolbar />)
    expect(markup).toContain('Ready: 2')
    expect(markup).toContain('Running: 1')
    expect(markup).toContain('Done: 3')
    expect(markup).toContain('Failed: 0')
  })

  test('renders dark mode toggle', () => {
    const markup = renderToStaticMarkup(<Toolbar />)
    expect(markup).toContain('Toggle dark mode')
  })

  test('renders h-12 toolbar container with border-b', () => {
    const markup = renderToStaticMarkup(<Toolbar />)
    expect(markup).toContain('h-12')
    expect(markup).toContain('border-b')
  })

  test('renders search input with w-48 width class', () => {
    const markup = renderToStaticMarkup(<Toolbar />)
    expect(markup).toContain('w-48')
  })

  test('Run Runnable button has blue-600 background', () => {
    const markup = renderToStaticMarkup(<Toolbar />)
    expect(markup).toContain('bg-blue-600')
  })

  test('renders MessageSquare icon alongside Chat text', () => {
    const markup = renderToStaticMarkup(<Toolbar />)
    // The Chat button has flex items-center gap-1 for icon alignment
    expect(markup).toContain('gap-1')
    expect(markup).toContain('Chat')
  })

  test('status summary section has ml-auto for right alignment', () => {
    const markup = renderToStaticMarkup(<Toolbar />)
    expect(markup).toContain('ml-auto')
  })

  test('status summary items use semantic color classes', () => {
    const markup = renderToStaticMarkup(<Toolbar />)
    expect(markup).toContain('text-blue-600')
    expect(markup).toContain('text-green-600')
    expect(markup).toContain('text-red-600')
  })

  test('search input type is text', () => {
    const markup = renderToStaticMarkup(<Toolbar />)
    expect(markup).toContain('type="text"')
  })

  test('toolbar buttons have muted-foreground text style', () => {
    const markup = renderToStaticMarkup(<Toolbar />)
    expect(markup).toContain('text-muted-foreground')
  })

  test('status summary is hidden on small screens with max-md:hidden', () => {
    const markup = renderToStaticMarkup(<Toolbar />)
    expect(markup).toContain('max-md:hidden')
  })
})

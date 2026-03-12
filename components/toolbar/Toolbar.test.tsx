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
})

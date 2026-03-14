import { describe, test, expect, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('@/lib/ui/api', () => ({
  useStatus: () => ({
    data: {
      steps: [{ id: 'step-a' }],
      gates: [{ id: 'gate-1' }],
      summary: {},
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


const { CreateNodeDialog } = await import('./CreateNodeDialog')

describe('CreateNodeDialog', () => {
  test('returns null when closed', () => {
    const markup = renderToStaticMarkup(<CreateNodeDialog open={false} onClose={() => {}} />)
    expect(markup).toBe('')
  })

  test('renders dialog when open', () => {
    const markup = renderToStaticMarkup(<CreateNodeDialog open={true} onClose={() => {}} />)
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
  })

  test('renders New Step title by default', () => {
    const markup = renderToStaticMarkup(<CreateNodeDialog open={true} onClose={() => {}} />)
    expect(markup).toContain('New Step')
  })

  test('renders ID input field', () => {
    const markup = renderToStaticMarkup(<CreateNodeDialog open={true} onClose={() => {}} />)
    expect(markup).toContain('my-step-id')
    expect(markup).toContain('ID')
  })

  test('renders Name input field', () => {
    const markup = renderToStaticMarkup(<CreateNodeDialog open={true} onClose={() => {}} />)
    expect(markup).toContain('Human-readable name')
  })

  test('renders step type buttons', () => {
    const markup = renderToStaticMarkup(<CreateNodeDialog open={true} onClose={() => {}} />)
    expect(markup).toContain('Base')
    expect(markup).toContain('Parallel')
    expect(markup).toContain('Compute')
    expect(markup).toContain('Fusion')
    expect(markup).toContain('Branch')
    expect(markup).toContain('Loop')
  })

  test('renders model buttons', () => {
    const markup = renderToStaticMarkup(<CreateNodeDialog open={true} onClose={() => {}} />)
    expect(markup).toContain('Claude Code')
    expect(markup).toContain('Codex')
    expect(markup).toContain('Gemini')
    expect(markup).toContain('Shell')
  })

  test('renders cancel and submit buttons', () => {
    const markup = renderToStaticMarkup(<CreateNodeDialog open={true} onClose={() => {}} />)
    expect(markup).toContain('Cancel')
    expect(markup).toContain('Add Step')
  })

  test('renders step and gate kind switcher', () => {
    const markup = renderToStaticMarkup(<CreateNodeDialog open={true} onClose={() => {}} />)
    expect(markup).toContain('Step')
    expect(markup).toContain('Gate')
  })

  test('renders dependencies section', () => {
    const markup = renderToStaticMarkup(<CreateNodeDialog open={true} onClose={() => {}} />)
    expect(markup).toContain('Dependencies')
    expect(markup).toContain('step-a')
    expect(markup).toContain('gate-1')
  })

  test('renders gate mode when initialKind is gate', () => {
    const markup = renderToStaticMarkup(<CreateNodeDialog open={true} onClose={() => {}} initialKind="gate" />)
    expect(markup).toContain('New Gate')
    expect(markup).toContain('Add Gate')
  })
})

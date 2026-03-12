import { describe, test, expect, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

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
  useBlockGate: () => ({ mutate: () => {}, isPending: false, error: null }),
  useEditStep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, error: null }),
  useRemoveStep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, error: null }),
  useCloneStep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, error: null }),
  useAddStep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useInsertGate: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useAddDep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useRemoveDep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
}))

const { StepActions } = await import('./StepActions')

describe('StepActions — step mode', () => {
  test('renders Run button', () => {
    const markup = renderToStaticMarkup(<StepActions nodeId="step-1" isGate={false} />)
    expect(markup).toContain('Run')
  })

  test('renders Stop button', () => {
    const markup = renderToStaticMarkup(<StepActions nodeId="step-1" isGate={false} />)
    expect(markup).toContain('Stop')
  })

  test('renders Restart button', () => {
    const markup = renderToStaticMarkup(<StepActions nodeId="step-1" isGate={false} />)
    expect(markup).toContain('Restart')
  })

  test('renders Clone button', () => {
    const markup = renderToStaticMarkup(<StepActions nodeId="step-1" isGate={false} />)
    expect(markup).toContain('Clone')
  })

  test('renders Delete button', () => {
    const markup = renderToStaticMarkup(<StepActions nodeId="step-1" isGate={false} />)
    expect(markup).toContain('Delete')
  })
})

describe('StepActions — gate mode', () => {
  test('renders Approve button', () => {
    const markup = renderToStaticMarkup(<StepActions nodeId="gate-1" isGate={true} />)
    expect(markup).toContain('Approve')
  })

  test('renders Block button', () => {
    const markup = renderToStaticMarkup(<StepActions nodeId="gate-1" isGate={true} />)
    expect(markup).toContain('Block')
  })

  test('does not render Run/Stop/Restart in gate mode', () => {
    const markup = renderToStaticMarkup(<StepActions nodeId="gate-1" isGate={true} />)
    expect(markup).not.toContain('Run')
    expect(markup).not.toContain('Restart')
  })
})

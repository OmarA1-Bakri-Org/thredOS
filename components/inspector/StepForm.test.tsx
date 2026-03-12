import { describe, test, expect, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('@/lib/ui/api', () => ({
  useStatus: () => ({
    data: {
      steps: [
        { id: 'step-a', name: 'Step A' },
        { id: 'step-b', name: 'Step B' },
      ],
      gates: [{ id: 'gate-1', name: 'Gate 1' }],
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


const { StepForm } = await import('./StepForm')

const step = {
  id: 'step-a',
  name: 'Research',
  type: 'base',
  model: 'claude-code',
  status: 'READY',
  dependsOn: ['gate-1'],
}

describe('StepForm — read mode', () => {
  test('renders step name', () => {
    const markup = renderToStaticMarkup(<StepForm step={step} />)
    expect(markup).toContain('Research')
  })

  test('renders step type', () => {
    const markup = renderToStaticMarkup(<StepForm step={step} />)
    expect(markup).toContain('base')
  })

  test('renders step model', () => {
    const markup = renderToStaticMarkup(<StepForm step={step} />)
    expect(markup).toContain('claude-code')
  })

  test('renders step status', () => {
    const markup = renderToStaticMarkup(<StepForm step={step} />)
    expect(markup).toContain('READY')
  })

  test('renders dependencies', () => {
    const markup = renderToStaticMarkup(<StepForm step={step} />)
    expect(markup).toContain('gate-1')
  })

  test('renders Edit button', () => {
    const markup = renderToStaticMarkup(<StepForm step={step} />)
    expect(markup).toContain('Edit')
  })

  test('renders add dependency option', () => {
    const markup = renderToStaticMarkup(<StepForm step={step} />)
    expect(markup).toContain('Add dependency')
  })

  test('renders None when no dependencies', () => {
    const stepNoDeps = { ...step, dependsOn: [] }
    const markup = renderToStaticMarkup(<StepForm step={stepNoDeps} />)
    expect(markup).toContain('None')
  })
})

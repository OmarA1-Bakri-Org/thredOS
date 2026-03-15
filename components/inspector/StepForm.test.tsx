import { describe, test, expect, mock, afterEach } from 'bun:test'
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

afterEach(() => { mock.restore() })

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

  test('renders field section labels: Name, Type, Model, Status, Dependencies', () => {
    const markup = renderToStaticMarkup(<StepForm step={step} />)
    expect(markup).toContain('Name')
    expect(markup).toContain('Type')
    expect(markup).toContain('Model')
    expect(markup).toContain('Status')
    expect(markup).toContain('Dependencies')
  })

  test('renders "Fields" header label', () => {
    const markup = renderToStaticMarkup(<StepForm step={step} />)
    expect(markup).toContain('Fields')
  })

  test('renders available deps that are not already in dependsOn', () => {
    // step-a depends on gate-1, so available deps should be step-b only
    // (step-a is excluded because it is the current step)
    const markup = renderToStaticMarkup(<StepForm step={step} />)
    expect(markup).toContain('step-b')
  })

  test('renders remove dependency button with aria-label', () => {
    const markup = renderToStaticMarkup(<StepForm step={step} />)
    expect(markup).toContain('aria-label="Remove dependency gate-1"')
  })

  test('renders Pencil icon in Edit button', () => {
    const markup = renderToStaticMarkup(<StepForm step={step} />)
    expect(markup).toContain('<svg')
  })

  test('does not render error message when there is no error', () => {
    const markup = renderToStaticMarkup(<StepForm step={step} />)
    expect(markup).not.toContain('border-rose-500/35')
  })

  test('renders multiple dependencies when present', () => {
    const stepMultiDeps = { ...step, dependsOn: ['gate-1', 'step-b'] }
    const markup = renderToStaticMarkup(<StepForm step={stepMultiDeps} />)
    expect(markup).toContain('gate-1')
    expect(markup).toContain('step-b')
  })

  test('does not render Add dependency when no available deps remain', () => {
    // If the step depends on everything except itself, no available deps
    const stepAllDeps = { ...step, dependsOn: ['step-b', 'gate-1'] }
    const markup = renderToStaticMarkup(<StepForm step={stepAllDeps} />)
    expect(markup).not.toContain('+ Add dependency')
  })

  test('renders the step status with monospace font', () => {
    const markup = renderToStaticMarkup(<StepForm step={step} />)
    // Status is rendered with font-mono uppercase
    expect(markup).toContain('font-mono uppercase')
  })

  test('renders name inside a blue-bordered card', () => {
    const markup = renderToStaticMarkup(<StepForm step={step} />)
    expect(markup).toContain('border-[#16417C]/70')
  })
})

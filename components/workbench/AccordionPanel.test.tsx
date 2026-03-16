import { describe, expect, test, mock, beforeEach } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

const storeState = {
  activeAccordionSections: ['sequence'] as string[],
  setActiveAccordionSections: (_sections: string[]) => {},
  expandAccordionSection: (_section: string) => {},
  collapseAccordionSection: (_section: string) => {},
  selectedNodeId: null as string | null,
  setSelectedNodeId: (_id: string | null) => {},
  selectedThreadSurfaceId: null as string | null,
  setSelectedThreadSurfaceId: (_id: string | null) => {},
  selectedPhaseId: null as string | null,
  setSelectedPhaseId: (_id: string | null) => {},
  selectPhaseAndFocus: (_phaseId: string) => {},
  selectedRunId: null as string | null,
  navigationStack: [] as Array<{ threadSurfaceId: string; surfaceLabel: string; depth: number }>,
}

mock.module('@/lib/ui/store', () => ({
  useUIStore: Object.assign(
    (selector: (s: typeof storeState) => unknown) => selector(storeState),
    {
      setState: (patch: Partial<typeof storeState>) => Object.assign(storeState, patch),
      getState: () => storeState,
    },
  ),
  selectCurrentDepthSurfaceId: (s: typeof storeState) => {
    const stack = s.navigationStack
    return stack.length > 0 ? stack[stack.length - 1].threadSurfaceId : null
  },
  selectCurrentDepthLevel: (s: typeof storeState) => {
    const stack = s.navigationStack
    return stack.length > 0 ? stack[stack.length - 1].depth : 0
  },
  selectPathSegments: () => [],
}))

mock.module('@/lib/ui/api', () => ({
  useThreadSurfaces: () => ({
    data: [
      { id: 'thread-master', surfaceLabel: 'Master Thread', depth: 0, role: 'orchestrator', childSurfaceIds: ['thread-child'] },
    ],
  }),
  useStatus: () => ({
    data: {
      name: 'test-sequence',
      summary: { ready: 2, running: 1, done: 3, failed: 0 },
      steps: [
        { id: 'step-1', name: 'Step One', type: 'base', model: 'claude-code', status: 'ready', dependsOn: [] },
        { id: 'step-2', name: 'Step Two', type: 'c', model: 'gpt-4o', status: 'running', dependsOn: ['step-1'] },
      ],
      gates: [
        { id: 'gate-step-1', name: 'Gate for Step 1', status: 'pending' },
      ],
    },
    isLoading: false,
  }),
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
  useThreadSurfaceSkills: () => ({ data: [] }),
  useAgentProfile: () => ({ data: null }),
  useListAgents: () => ({ data: [], isLoading: false }),
  useRegisterAgent: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useAssignAgent: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useSequence: () => ({ data: null }),
  useUpdateGate: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useRenameSequence: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useSetThreadType: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useApplyTemplate: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useRemoveGate: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useResetSequence: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
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

const { AccordionPanel } = await import('./AccordionPanel')

describe('AccordionPanel', () => {
  beforeEach(() => {
    Object.assign(storeState, {
      activeAccordionSections: ['sequence'],
      selectedNodeId: null,
      selectedPhaseId: null,
    })
  })

  test('renders all 6 section tab triggers with short labels', () => {
    const markup = renderToStaticMarkup(<AccordionPanel />)
    expect(markup).toContain('SEQ')
    expect(markup).toContain('PHS')
    expect(markup).toContain('NODE')
    expect(markup).toContain('AGT')
    expect(markup).toContain('GATE')
    expect(markup).toContain('RUN')
  })

  test('renders the panel container with single-column width when few sections open', () => {
    const markup = renderToStaticMarkup(<AccordionPanel />)
    // With only 1 section open, panel stays at 380px (inline style)
    expect(markup).toContain('width:380px')
  })

  test('renders info buttons on each section', () => {
    const markup = renderToStaticMarkup(<AccordionPanel />)
    // Each tab trigger and each open content header has an info button
    const infoCount = (markup.match(/Panel info/g) || []).length
    // 6 tab triggers + 1 open section header = at least 7
    expect(infoCount).toBeGreaterThanOrEqual(7)
  })

  test('renders active section content — SEQUENCE shows thread surface', () => {
    const markup = renderToStaticMarkup(<AccordionPanel />)
    // Sequence is active by default — should show thread surface browser
    expect(markup).toContain('SEQUENCE')
    expect(markup).toContain('Master Thread')
  })

  test('renders horizontal tab bar layout with aria-pressed', () => {
    const markup = renderToStaticMarkup(<AccordionPanel />)
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('aria-pressed="false"')
  })

  test('section tabs have distinct accent colors', () => {
    storeState.activeAccordionSections = ['sequence', 'phase', 'agent']
    const markup = renderToStaticMarkup(<AccordionPanel />)
    // Each section has its own accent color
    expect(markup).toContain('sky-500')     // SEQUENCE
    expect(markup).toContain('violet-500')  // PHASE
    expect(markup).toContain('emerald-500') // AGENT
  })

  test('shows thread type identification in SEQUENCE section', () => {
    const markup = renderToStaticMarkup(<AccordionPanel />)
    // Thread type badges should appear
    expect(markup).toContain('Base')
    expect(markup).toContain('Parallel')
    expect(markup).toContain('Chained')
    expect(markup).toContain('Fusion')
  })

  test('shows phase overview in SEQUENCE section', () => {
    const markup = renderToStaticMarkup(<AccordionPanel />)
    // Phase overview should show phase count
    expect(markup).toContain('Phase overview')
    expect(markup).toContain('phases')
  })

  test('shows empty state when no panels open', () => {
    storeState.activeAccordionSections = []
    const markup = renderToStaticMarkup(<AccordionPanel />)
    expect(markup).toContain('No panels open')
    expect(markup).toContain('SEQUENCE')
    expect(markup).toContain('RUN')
  })

  test('PHASE section renders phase list', () => {
    storeState.activeAccordionSections = ['phase']
    const markup = renderToStaticMarkup(<AccordionPanel />)
    expect(markup).toContain('PHASE')
    expect(markup).toContain('Step One')
    expect(markup).toContain('Step Two')
  })

  test('NODE section shows phase-required message when no phase selected', () => {
    storeState.activeAccordionSections = ['node']
    storeState.selectedPhaseId = null
    const markup = renderToStaticMarkup(<AccordionPanel />)
    expect(markup).toContain('Select a phase first')
  })

  test('AGENT section renders with sub-tabs', () => {
    storeState.activeAccordionSections = ['agent']
    const markup = renderToStaticMarkup(<AccordionPanel />)
    expect(markup).toContain('Workshop')
    expect(markup).toContain('Roster')
    expect(markup).toContain('Assign')
    expect(markup).toContain('Stats')
    expect(markup).toContain('Tools')
  })

  test('GATE section shows phase-required message when no phase selected', () => {
    storeState.activeAccordionSections = ['gate']
    storeState.selectedPhaseId = null
    const markup = renderToStaticMarkup(<AccordionPanel />)
    expect(markup).toContain('Select a phase first')
  })

  test('RUN section renders run controls', () => {
    storeState.activeAccordionSections = ['run']
    const markup = renderToStaticMarkup(<AccordionPanel />)
    expect(markup).toContain('Run all')
    expect(markup).toContain('Controls')
  })

  test('shows phase scope dot when NODE/AGENT/GATE tabs have phase context', () => {
    storeState.selectedPhaseId = 'phase-step-1'
    storeState.activeAccordionSections = ['sequence']
    const markup = renderToStaticMarkup(<AccordionPanel />)
    // Phase scope dots should appear for NODE/AGENT/GATE tabs
    // The dots are small emerald circles rendered as spans
    const emeraldDots = (markup.match(/bg-emerald-400/g) || []).length
    expect(emeraldDots).toBeGreaterThanOrEqual(3)
  })
})

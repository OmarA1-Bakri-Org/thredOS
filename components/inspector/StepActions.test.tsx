import { describe, test, expect, mock, afterEach } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

const uiState: Record<string, unknown> = {
  productEntry: null,
  setProductEntry: () => {},
  selectedNodeId: null as string | null,
  setSelectedNodeId: () => {},
  leftRailOpen: false,
  toggleLeftRail: () => {},
  closeLeftRail: () => {},
  inspectorOpen: false,
  toggleInspector: () => {},
  closeInspector: () => {},
  chatOpen: false,
  toggleChat: () => {},
  searchQuery: '',
  setSearchQuery: () => {},
  minimapVisible: true,
  toggleMinimap: () => {},
  viewMode: 'hierarchy',
  setViewMode: () => {},
  selectedThreadSurfaceId: null,
  setSelectedThreadSurfaceId: () => {},
  selectedRunId: null,
  setSelectedRunId: () => {},
  hierarchyViewport: { x: 0, y: 0, zoom: 1 },
  setHierarchyViewport: () => {},
  laneFocusThreadSurfaceId: null,
  setLaneFocusThreadSurfaceId: () => {},
  laneBoardState: { scrollLeft: 0, focusedThreadSurfaceId: null, focusedRunId: null },
  setLaneBoardState: () => {},
  openLaneViewForThreadSurface: () => {},
  createDialogOpen: false,
  createDialogKind: 'step',
  openCreateDialog: () => {},
  closeCreateDialog: () => {},
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
  useRemoveGate: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, error: null }),
  useCloneStep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, error: null }),
  useAddStep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useInsertGate: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useAddDep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useRemoveDep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useResetSequence: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useAgentPerformance: () => ({ data: null, isLoading: false }),
  useGateMetrics: () => ({ data: null, isLoading: false }),
}))

afterEach(() => { mock.restore() })

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

  test('renders Play icon SVG in Run button', () => {
    const markup = renderToStaticMarkup(<StepActions nodeId="step-1" isGate={false} />)
    expect(markup).toContain('<svg')
  })

  test('renders the separator border between action groups', () => {
    const markup = renderToStaticMarkup(<StepActions nodeId="step-1" isGate={false} />)
    expect(markup).toContain('border-t border-slate-800/60')
  })

  test('does not render ConfirmDialog when no pending action', () => {
    const markup = renderToStaticMarkup(<StepActions nodeId="step-1" isGate={false} />)
    // ConfirmDialog returns null when open=false
    expect(markup).not.toContain('Confirm action')
    expect(markup).not.toContain('confirm-dialog')
  })

  test('does not render error message when no errors', () => {
    const markup = renderToStaticMarkup(<StepActions nodeId="step-1" isGate={false} />)
    expect(markup).not.toContain('border-rose-500/35')
  })

  test('renders all step action buttons as type="button"', () => {
    const markup = renderToStaticMarkup(<StepActions nodeId="step-1" isGate={false} />)
    // Each button should have type="button" to prevent form submission
    const buttonMatches = markup.match(/type="button"/g)
    expect(buttonMatches).toBeTruthy()
    expect(buttonMatches!.length).toBeGreaterThanOrEqual(5) // Run, Stop, Restart, Clone, Delete
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

  test('does not render Clone in gate mode but renders Delete', () => {
    const markup = renderToStaticMarkup(<StepActions nodeId="gate-1" isGate={true} />)
    expect(markup).not.toContain('Clone')
    expect(markup).toContain('Delete')
  })

  test('renders success variant for Approve button', () => {
    const markup = renderToStaticMarkup(<StepActions nodeId="gate-1" isGate={true} />)
    // success variant has emerald styling
    expect(markup).toContain('emerald')
  })

  test('renders destructive variant for Block button', () => {
    const markup = renderToStaticMarkup(<StepActions nodeId="gate-1" isGate={true} />)
    // destructive variant has rose styling
    expect(markup).toContain('rose')
  })

  test('renders ShieldCheck icon in Approve button', () => {
    const markup = renderToStaticMarkup(<StepActions nodeId="gate-1" isGate={true} />)
    expect(markup).toContain('<svg')
  })

  test('does not render ConfirmDialog when no pending action in gate mode', () => {
    const markup = renderToStaticMarkup(<StepActions nodeId="gate-1" isGate={true} />)
    expect(markup).not.toContain('Confirm action')
    expect(markup).not.toContain('confirm-dialog')
  })
})

describe('StepActions — pending states', () => {
  test('renders Running label when runStep is pending', async () => {
    mock.module('@/lib/ui/api', () => ({
      useStatus: () => ({ data: { steps: [], gates: [], summary: {} }, isLoading: false }),
      useSequence: () => ({ data: null }),
      useThreadSurfaces: () => ({ data: [] }),
      useThreadRuns: () => ({ data: [] }),
      useThreadMerges: () => ({ data: [] }),
      useRunStep: () => ({ mutate: () => {}, isPending: true, error: null }),
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
    }))
    mock.module('@/lib/ui/store', () => ({
      useUIStore: Object.assign(
        (selector: (s: typeof uiState) => unknown) => selector(uiState),
        { setState: (patch: Partial<typeof uiState>) => Object.assign(uiState, patch), getState: () => uiState },
      ),
    }))
    const { StepActions: SA } = await import('./StepActions')
    const markup = renderToStaticMarkup(<SA nodeId="step-1" isGate={false} />)
    expect(markup).toContain('Running')
  })

  test('renders Approving label when approveGate is pending', async () => {
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
      useApproveGate: () => ({ mutate: () => {}, isPending: true, error: null }),
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
    }))
    mock.module('@/lib/ui/store', () => ({
      useUIStore: Object.assign(
        (selector: (s: typeof uiState) => unknown) => selector(uiState),
        { setState: (patch: Partial<typeof uiState>) => Object.assign(uiState, patch), getState: () => uiState },
      ),
    }))
    const { StepActions: SA } = await import('./StepActions')
    const markup = renderToStaticMarkup(<SA nodeId="gate-1" isGate={true} />)
    expect(markup).toContain('Approving')
  })

  test('renders error message when a hook has an error', async () => {
    mock.module('@/lib/ui/api', () => ({
      useStatus: () => ({ data: { steps: [], gates: [], summary: {} }, isLoading: false }),
      useSequence: () => ({ data: null }),
      useThreadSurfaces: () => ({ data: [] }),
      useThreadRuns: () => ({ data: [] }),
      useThreadMerges: () => ({ data: [] }),
      useRunStep: () => ({ mutate: () => {}, isPending: false, error: new Error('Step execution failed') }),
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
    }))
    mock.module('@/lib/ui/store', () => ({
      useUIStore: Object.assign(
        (selector: (s: typeof uiState) => unknown) => selector(uiState),
        { setState: (patch: Partial<typeof uiState>) => Object.assign(uiState, patch), getState: () => uiState },
      ),
    }))
    const { StepActions: SA } = await import('./StepActions')
    const markup = renderToStaticMarkup(<SA nodeId="step-1" isGate={false} />)
    expect(markup).toContain('Step execution failed')
    expect(markup).toContain('border-rose-500/35')
  })

  test('renders Cloning... label when cloneStep is pending', async () => {
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
      useCloneStep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: true, error: null }),
      useAddStep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
      useInsertGate: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
      useAddDep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
      useRemoveDep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
      useAgentPerformance: () => ({ data: null, isLoading: false }),
      useGateMetrics: () => ({ data: null, isLoading: false }),
    }))
    mock.module('@/lib/ui/store', () => ({
      useUIStore: Object.assign(
        (selector: (s: typeof uiState) => unknown) => selector(uiState),
        { setState: (patch: Partial<typeof uiState>) => Object.assign(uiState, patch), getState: () => uiState },
      ),
    }))
    const { StepActions: SA } = await import('./StepActions')
    const markup = renderToStaticMarkup(<SA nodeId="step-1" isGate={false} />)
    expect(markup).toContain('Cloning...')
  })

  test('renders Deleting... label when removeStep is pending', async () => {
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
      useRemoveStep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: true, error: null }),
      useCloneStep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, error: null }),
      useAddStep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
      useInsertGate: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
      useAddDep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
      useRemoveDep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
      useAgentPerformance: () => ({ data: null, isLoading: false }),
      useGateMetrics: () => ({ data: null, isLoading: false }),
    }))
    mock.module('@/lib/ui/store', () => ({
      useUIStore: Object.assign(
        (selector: (s: typeof uiState) => unknown) => selector(uiState),
        { setState: (patch: Partial<typeof uiState>) => Object.assign(uiState, patch), getState: () => uiState },
      ),
    }))
    const { StepActions: SA } = await import('./StepActions')
    const markup = renderToStaticMarkup(<SA nodeId="step-1" isGate={false} />)
    expect(markup).toContain('Deleting...')
  })
})

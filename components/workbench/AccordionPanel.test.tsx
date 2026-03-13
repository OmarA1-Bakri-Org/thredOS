import { describe, expect, test, mock, beforeEach } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

const storeState = {
  activeAccordionSections: ['navigator'] as string[],
  setActiveAccordionSections: (_sections: string[]) => {},
  expandAccordionSection: (_section: string) => {},
  collapseAccordionSection: (_section: string) => {},
  selectedNodeId: null as string | null,
  selectedThreadSurfaceId: null as string | null,
  setSelectedThreadSurfaceId: (_id: string | null) => {},
}

mock.module('@/lib/ui/store', () => ({
  useUIStore: Object.assign(
    (selector: (s: typeof storeState) => unknown) => selector(storeState),
    {
      setState: (patch: Partial<typeof storeState>) => Object.assign(storeState, patch),
      getState: () => storeState,
    },
  ),
}))

mock.module('@/lib/ui/api', () => ({
  useThreadSurfaces: () => ({
    data: [
      { id: 'thread-master', surfaceLabel: 'Master Thread', depth: 0, role: 'orchestrator', childSurfaceIds: ['thread-child'] },
    ],
  }),
  useStatus: () => ({ data: null, isLoading: false }),
  useSequence: () => ({ data: null, isLoading: false }),
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
}))

const { AccordionPanel } = await import('./AccordionPanel')

describe('AccordionPanel', () => {
  beforeEach(() => {
    Object.assign(storeState, {
      activeAccordionSections: ['navigator'],
      selectedNodeId: null,
    })
  })

  test('renders all 6 section tab triggers with short labels', () => {
    const markup = renderToStaticMarkup(<AccordionPanel />)
    expect(markup).toContain('NAV')
    expect(markup).toContain('DETAIL')
    expect(markup).toContain('DEPS')
    expect(markup).toContain('CTX')
    expect(markup).toContain('SKILLS')
    expect(markup).toContain('STRUCT')
  })

  test('renders the panel container with single-column width when few sections open', () => {
    const markup = renderToStaticMarkup(<AccordionPanel />)
    // With only 1 section open, panel stays at 380px
    expect(markup).toContain('w-[380px]')
  })

  test('renders info buttons on each section', () => {
    const markup = renderToStaticMarkup(<AccordionPanel />)
    // Each tab trigger and each open content header has an info button
    const infoCount = (markup.match(/Panel info/g) || []).length
    // 6 tab triggers + 1 open section header = at least 7
    expect(infoCount).toBeGreaterThanOrEqual(7)
  })

  test('renders active section content and header label', () => {
    const markup = renderToStaticMarkup(<AccordionPanel />)
    // Navigator is active by default — should render full label and content
    expect(markup).toContain('NAVIGATOR')
    expect(markup).toContain('Master Thread')
  })

  test('renders horizontal tab bar layout', () => {
    const markup = renderToStaticMarkup(<AccordionPanel />)
    // Tab buttons have aria-pressed
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('aria-pressed="false"')
  })
})

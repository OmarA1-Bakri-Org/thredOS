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
}))

const { AccordionPanel } = await import('./AccordionPanel')

describe('AccordionPanel', () => {
  beforeEach(() => {
    Object.assign(storeState, {
      activeAccordionSections: ['navigator'],
      selectedNodeId: null,
    })
  })

  test('renders all 6 section headers', () => {
    const markup = renderToStaticMarkup(<AccordionPanel />)
    expect(markup).toContain('NAVIGATOR')
    expect(markup).toContain('STEP / GATE DETAIL')
    expect(markup).toContain('DEPENDENCIES')
    expect(markup).toContain('THREAD CONTEXT')
    expect(markup).toContain('SKILLS')
    expect(markup).toContain('STRUCTURE')
  })

  test('renders the panel container with correct width', () => {
    const markup = renderToStaticMarkup(<AccordionPanel />)
    expect(markup).toContain('w-[380px]')
  })

  test('renders accordion items with border styling', () => {
    const markup = renderToStaticMarkup(<AccordionPanel />)
    // All 6 accordion items should be rendered with border styling
    const itemCount = (markup.match(/border-b border-slate-800\/60/g) || []).length
    // 6 accordion items + 1 panel header = 7 elements with this border class
    expect(itemCount).toBeGreaterThanOrEqual(6)
    // Radix renders data-orientation on each accordion item
    const orientationCount = (markup.match(/data-orientation="vertical"/g) || []).length
    expect(orientationCount).toBeGreaterThanOrEqual(6)
    // The navigator section should be open by default with real content
    expect(markup).toContain('Master Thread')
  })
})

import { describe, expect, test, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

const uiState = {
  selectedThreadSurfaceId: null as string | null,
  setSelectedThreadSurfaceId: (_id: string | null) => {},
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
  useThreadSurfaces: () => ({
  useAgentPerformance: () => ({ data: null, isLoading: false }),
  useGateMetrics: () => ({ data: null, isLoading: false }),
    data: [
      { id: 'thread-master', surfaceLabel: 'Master Thread', depth: 0, role: 'orchestrator', childSurfaceIds: ['thread-child'] },
      { id: 'thread-child', surfaceLabel: 'Child Thread', depth: 1, role: 'worker', childSurfaceIds: [] },
    ],
  }),
}))

const { ThreadNavigatorContent } = await import('./ThreadNavigatorContent')

describe('ThreadNavigatorContent', () => {
  test('renders thread surface list with labels and metadata', () => {
    const markup = renderToStaticMarkup(<ThreadNavigatorContent />)
    expect(markup).toContain('Master Thread')
    expect(markup).toContain('Child Thread')
    expect(markup).toContain('depth 0')
    expect(markup).toContain('orchestrator')
  })
})

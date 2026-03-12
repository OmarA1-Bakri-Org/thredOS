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

const { CanvasContextMenu } = await import('./CanvasContextMenu')

describe('CanvasContextMenu', () => {
  test('returns null when menu is null', () => {
    const markup = renderToStaticMarkup(<CanvasContextMenu menu={null} onClose={() => {}} />)
    expect(markup).toBe('')
  })

  test('renders node context menu with Run, Stop, Clone, Delete', () => {
    const menu = { x: 100, y: 200, nodeId: 'step-1' }
    const markup = renderToStaticMarkup(<CanvasContextMenu menu={menu} onClose={() => {}} />)
    expect(markup).toContain('Run')
    expect(markup).toContain('Stop')
    expect(markup).toContain('Clone')
    expect(markup).toContain('Delete')
  })

  test('renders canvas context menu with Add Step, Add Gate when nodeId is null', () => {
    const menu = { x: 100, y: 200, nodeId: null }
    const markup = renderToStaticMarkup(<CanvasContextMenu menu={menu} onClose={() => {}} />)
    expect(markup).toContain('Add Step')
    expect(markup).toContain('Add Gate')
  })

  test('positions menu at specified coordinates', () => {
    const menu = { x: 150, y: 300, nodeId: null }
    const markup = renderToStaticMarkup(<CanvasContextMenu menu={menu} onClose={() => {}} />)
    expect(markup).toContain('left:150px')
    expect(markup).toContain('top:300px')
  })

  test('does not show Add Step/Gate in node menu', () => {
    const menu = { x: 100, y: 200, nodeId: 'step-1' }
    const markup = renderToStaticMarkup(<CanvasContextMenu menu={menu} onClose={() => {}} />)
    expect(markup).not.toContain('Add Step')
    expect(markup).not.toContain('Add Gate')
  })

  test('does not show Run/Stop/Clone/Delete in canvas menu', () => {
    const menu = { x: 100, y: 200, nodeId: null }
    const markup = renderToStaticMarkup(<CanvasContextMenu menu={menu} onClose={() => {}} />)
    expect(markup).not.toContain('>Run<')
    expect(markup).not.toContain('>Stop<')
    expect(markup).not.toContain('>Clone<')
    expect(markup).not.toContain('>Delete<')
  })
})

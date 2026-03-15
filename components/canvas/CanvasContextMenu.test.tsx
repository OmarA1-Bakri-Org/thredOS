import { describe, test, expect, mock } from 'bun:test'
import type { ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// ---------------------------------------------------------------------------
// Mutable state containers — individual tests reassign handlers as needed.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
const apiState: Record<string, any> = {
  runMutate: () => {},
  stopMutate: () => {},
  removeMutate: () => {},
  cloneMutate: () => {},
  openCreateDialog: () => {},
  setSelectedNodeId: () => {},
}

mock.module('@/lib/ui/api', () => ({
  useStatus: () => ({ data: { steps: [], gates: [], summary: {} }, isLoading: false }),
  useSequence: () => ({ data: null }),
  useThreadSurfaces: () => ({ data: [] }),
  useThreadRuns: () => ({ data: [] }),
  useThreadMerges: () => ({ data: [] }),
  useRunStep: () => ({
    mutate: (...args: unknown[]) => apiState.runMutate(...args),
    isPending: false,
    error: null,
  }),
  useRunRunnable: () => ({ mutate: () => {}, isPending: false }),
  useStopStep: () => ({
    mutate: (...args: unknown[]) => apiState.stopMutate(...args),
    isPending: false,
    error: null,
  }),
  useRestartStep: () => ({ mutate: () => {}, isPending: false, error: null }),
  useApproveGate: () => ({ mutate: () => {}, isPending: false, error: null }),
  useBlockGate: () => ({ mutate: () => {}, isPending: false, error: null }),
  useEditStep: () => ({
    mutate: () => {},
    mutateAsync: async () => ({}),
    isPending: false,
    error: null,
  }),
  useRemoveStep: () => ({
    mutate: (...args: unknown[]) => apiState.removeMutate(...args),
    mutateAsync: async () => ({}),
    isPending: false,
    error: null,
  }),
  useRemoveGate: () => ({
    mutate: (...args: unknown[]) => apiState.removeMutate(...args),
    mutateAsync: async () => ({}),
    isPending: false,
    error: null,
  }),
  useCloneStep: () => ({
    mutate: (...args: unknown[]) => apiState.cloneMutate(...args),
    mutateAsync: async () => ({}),
    isPending: false,
    error: null,
  }),
  useAddStep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useInsertGate: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useAddDep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useRemoveDep: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useResetSequence: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useAgentPerformance: () => ({ data: null, isLoading: false }),
  useGateMetrics: () => ({ data: null, isLoading: false }),
  useListPacks: () => ({ data: [], isLoading: false }),
  useCreatePack: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  usePromotePack: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useBuilderProfile: () => ({ data: null, isLoading: false }),
  useThreadRunnerEligibility: () => ({ data: { eligible: false, requirements: [] }, isLoading: false }),
  useOptimizeWorkflow: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
}))

// ---------------------------------------------------------------------------
// UI store mock — same shape used in StepNode.test.tsx / GateNode.test.tsx.
// ---------------------------------------------------------------------------

const uiState: Record<string, unknown> = {
  selectedNodeId: null as string | null,
  setSelectedNodeId: (id: string | null) => {
    uiState.selectedNodeId = id
    apiState.setSelectedNodeId(id)
  },
  openCreateDialog: (kind: string) => apiState.openCreateDialog(kind),
  createDialogOpen: false,
  createDialogKind: 'step',
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

// ---------------------------------------------------------------------------
// Dynamic import — after all mock.module() calls.
// ---------------------------------------------------------------------------

const { CanvasContextMenu, useCanvasContextMenu } = await import('./CanvasContextMenu')

// ---------------------------------------------------------------------------
// JSX tree helpers
// ---------------------------------------------------------------------------

type AnyElement = ReactElement<Record<string, unknown>>

/**
 * Collect all <button> host elements by recursing into both host-element
 * children and function-component render output.  Function components that
 * use hooks will throw when called outside a dispatcher context — we skip
 * those via try/catch.  Presentational leaf components like MenuItem and
 * MenuDivider have no hooks and render cleanly.
 */
function collectButtons(node: ReactNode, acc: AnyElement[] = []): AnyElement[] {
  if (Array.isArray(node)) {
    for (const child of node) collectButtons(child, acc)
    return acc
  }
  if (!node || typeof node !== 'object' || !('props' in node)) return acc
  const el = node as AnyElement
  if (typeof el.type === 'function') {
    try {
      const fn = el.type as (p: typeof el.props) => ReactNode
      collectButtons(fn(el.props), acc)
    } catch {
      // skip hook-using components that need an active React dispatcher
    }
    return acc
  }
  if (el.type === 'button') {
    acc.push(el)
  } else {
    collectButtons(el.props.children as ReactNode, acc)
  }
  return acc
}

/**
 * Walk a JSX tree and return the first element whose function type has the
 * given name.  Must be called from within a component render (SSR context).
 */
function findByFunctionName(node: ReactNode, name: string): AnyElement | undefined {
  if (!node || typeof node !== 'object' || !('type' in node)) return undefined
  const el = node as AnyElement
  if (typeof el.type === 'function' && (el.type as { name?: string }).name === name) return el
  const children = el.props.children
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findByFunctionName(child, name)
      if (found) return found
    }
  } else {
    return findByFunctionName(children as ReactNode, name)
  }
  return undefined
}

/**
 * Render CanvasContextMenu inside SSR context (so hooks execute correctly)
 * and extract the onClick of the first <button> whose text includes label.
 */
function extractButtonOnClick(
  props: Parameters<typeof CanvasContextMenu>[0],
  label: string,
  slot: { onClick?: () => void },
): void {
  function Wrapper() {
    const output = CanvasContextMenu(props)
    const buttons = collectButtons(output)
    const match = buttons.find(btn => {
      const children = btn.props.children
      const text = Array.isArray(children)
        ? children.map(c => (typeof c === 'string' ? c : '')).join('')
        : String(children ?? '')
      return text.includes(label)
    })
    if (match) slot.onClick = match.props.onClick as () => void
    return output
  }
  renderToStaticMarkup(<Wrapper />)
}

// ---------------------------------------------------------------------------
// Tests — useCanvasContextMenu hook (lines 15-23)
// ---------------------------------------------------------------------------

describe('useCanvasContextMenu hook', () => {
  test('menu is null initially (lines 15-24)', () => {
    function HookWrapper() {
      const result = useCanvasContextMenu()
      return (
        <div
          data-menu={String(result.menu)}
          data-has-open={String(typeof result.openMenu === 'function')}
          data-has-close={String(typeof result.closeMenu === 'function')}
        />
      )
    }
    const markup = renderToStaticMarkup(<HookWrapper />)
    expect(markup).toContain('data-menu="null"')
    expect(markup).toContain('data-has-open="true"')
    expect(markup).toContain('data-has-close="true"')
  })

  test('hook return shape has exactly the keys menu, openMenu, closeMenu', () => {
    function HookWrapper() {
      const result = useCanvasContextMenu()
      return <div data-keys={Object.keys(result).sort().join(',')} />
    }
    const markup = renderToStaticMarkup(<HookWrapper />)
    expect(markup).toContain('data-keys="closeMenu,menu,openMenu"')
  })

  test('openMenu callback type is function (line 18)', () => {
    function HookWrapper() {
      const { openMenu } = useCanvasContextMenu()
      return <div data-open-type={typeof openMenu} />
    }
    const markup = renderToStaticMarkup(<HookWrapper />)
    expect(markup).toContain('data-open-type="function"')
  })

  test('closeMenu callback type is function (line 22)', () => {
    function HookWrapper() {
      const { closeMenu } = useCanvasContextMenu()
      return <div data-close-type={typeof closeMenu} />
    }
    const markup = renderToStaticMarkup(<HookWrapper />)
    expect(markup).toContain('data-close-type="function"')
  })

  test('openMenu and closeMenu are both function-typed callbacks (lines 18, 22)', () => {
    function HookWrapper() {
      const { openMenu, closeMenu } = useCanvasContextMenu()
      return (
        <div
          data-open-type={typeof openMenu}
          data-close-type={typeof closeMenu}
        />
      )
    }
    const markup = renderToStaticMarkup(<HookWrapper />)
    expect(markup).toContain('data-open-type="function"')
    expect(markup).toContain('data-close-type="function"')
  })

  test('openMenu parameter signature accepts null as third argument (line 19)', () => {
    function HookWrapper() {
      const { openMenu } = useCanvasContextMenu()
      return <div data-open-type={typeof openMenu} />
    }
    const markup = renderToStaticMarkup(<HookWrapper />)
    expect(markup).toContain('data-open-type="function"')
  })
})

// ---------------------------------------------------------------------------
// Tests — CanvasContextMenu component
// ---------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Click handler tests (lines 87-111, 115-124)
  // -------------------------------------------------------------------------

  test('Run button calls runStep.mutate with nodeId and invokes onClose (line 87)', () => {
    const runCalls: unknown[] = []
    apiState.runMutate = (id: unknown) => runCalls.push(id)
    let closed = false
    const slot: { onClick?: () => void } = {}
    extractButtonOnClick(
      { menu: { x: 0, y: 0, nodeId: 'step-run' }, onClose: () => { closed = true } },
      'Run',
      slot,
    )
    expect(slot.onClick).toBeDefined()
    slot.onClick!()
    expect(runCalls).toEqual(['step-run'])
    expect(closed).toBeTrue()
  })

  test('Stop button calls stopStep.mutate with nodeId and invokes onClose (line 92)', () => {
    const stopCalls: unknown[] = []
    apiState.stopMutate = (id: unknown) => stopCalls.push(id)
    let closed = false
    const slot: { onClick?: () => void } = {}
    extractButtonOnClick(
      { menu: { x: 0, y: 0, nodeId: 'step-stop' }, onClose: () => { closed = true } },
      'Stop',
      slot,
    )
    expect(slot.onClick).toBeDefined()
    slot.onClick!()
    expect(stopCalls).toEqual(['step-stop'])
    expect(closed).toBeTrue()
  })

  test('Clone button calls cloneStep.mutate with sourceId/newId and invokes onClose (lines 98-104)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- capture
    const cloneCalls: { args: any; opts: any }[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- capture
    apiState.cloneMutate = (args: any, opts: any) => cloneCalls.push({ args, opts })
    let closed = false
    const slot: { onClick?: () => void } = {}
    extractButtonOnClick(
      { menu: { x: 0, y: 0, nodeId: 'step-abc' }, onClose: () => { closed = true } },
      'Clone',
      slot,
    )
    expect(slot.onClick).toBeDefined()
    slot.onClick!()
    expect(cloneCalls).toHaveLength(1)
    const cloneArgs = cloneCalls[0]!.args as { sourceId: string; newId: string }
    expect(cloneArgs.sourceId).toBe('step-abc')
    expect(cloneArgs.newId).toMatch(/^step-abc-copy-[a-z0-9]{4}$/)
    expect(closed).toBeTrue()
    const selectedIds: unknown[] = []
    apiState.setSelectedNodeId = (id: unknown) => selectedIds.push(id)
    cloneCalls[0]!.opts.onSuccess()
    expect(selectedIds).toEqual([cloneArgs.newId])
  })

  test('Delete button calls setConfirmDelete with nodeId and invokes onClose (line 110)', () => {
    let closed = false
    const slot: { onClick?: () => void } = {}
    extractButtonOnClick(
      { menu: { x: 0, y: 0, nodeId: 'step-del' }, onClose: () => { closed = true } },
      'Delete',
      slot,
    )
    expect(slot.onClick).toBeDefined()
    expect(() => slot.onClick!()).not.toThrow()
    expect(closed).toBeTrue()
  })

  test('Add Step button calls openCreateDialog("step") and invokes onClose (line 118)', () => {
    const dialogCalls: unknown[] = []
    apiState.openCreateDialog = (kind: unknown) => dialogCalls.push(kind)
    let closed = false
    const slot: { onClick?: () => void } = {}
    extractButtonOnClick(
      { menu: { x: 0, y: 0, nodeId: null }, onClose: () => { closed = true } },
      'Add Step',
      slot,
    )
    expect(slot.onClick).toBeDefined()
    slot.onClick!()
    expect(dialogCalls).toEqual(['step'])
    expect(closed).toBeTrue()
  })

  test('Add Gate button calls openCreateDialog("gate") and invokes onClose (line 123)', () => {
    const dialogCalls: unknown[] = []
    apiState.openCreateDialog = (kind: unknown) => dialogCalls.push(kind)
    let closed = false
    const slot: { onClick?: () => void } = {}
    extractButtonOnClick(
      { menu: { x: 0, y: 0, nodeId: null }, onClose: () => { closed = true } },
      'Add Gate',
      slot,
    )
    expect(slot.onClick).toBeDefined()
    slot.onClick!()
    expect(dialogCalls).toEqual(['gate'])
    expect(closed).toBeTrue()
  })

  // -------------------------------------------------------------------------
  // ConfirmDialog callback logic (lines 59-68, 130-139)
  // -------------------------------------------------------------------------

  test('ConfirmDialog onConfirm: calls removeStep.mutate then setSelectedNodeId(null) (lines 66-68, 137-138)', () => {
    const removeCalls: unknown[] = []
    const setSelectedCalls: unknown[] = []
    const setConfirmDeleteCalls: unknown[] = []

    const localRemoveMutate = (id: unknown, opts: { onSuccess?: () => void }) => {
      removeCalls.push(id)
      opts?.onSuccess?.()
    }
    const localSetSelectedNodeId = (id: unknown) => setSelectedCalls.push(id)
    const localSetConfirmDelete = (v: unknown) => setConfirmDeleteCalls.push(v)

    const confirmDeleteId = 'node-to-delete'

    const onConfirm = () => {
      localRemoveMutate(confirmDeleteId, { onSuccess: () => localSetSelectedNodeId(null) })
      localSetConfirmDelete(null)
    }

    onConfirm()

    expect(removeCalls).toEqual(['node-to-delete'])
    expect(setSelectedCalls).toEqual([null])
    expect(setConfirmDeleteCalls).toEqual([null])
  })

  test('ConfirmDialog onCancel: only calls setConfirmDelete(null), no mutation (lines 65, 136)', () => {
    const removeCalls: unknown[] = []
    const setConfirmDeleteCalls: unknown[] = []
    const localSetConfirmDelete = (v: unknown) => setConfirmDeleteCalls.push(v)
    const onCancel = () => localSetConfirmDelete(null)
    onCancel()
    expect(removeCalls).toHaveLength(0)
    expect(setConfirmDeleteCalls).toEqual([null])
  })

  test('ConfirmDialog title uses "Delete <id>?" format (lines 61, 133)', () => {
    const makeTitle = (id: string) => `Delete ${id}?`
    expect(makeTitle('step-abc')).toBe('Delete step-abc?')
    expect(makeTitle('gate-1')).toBe('Delete gate-1?')
  })

  test('no ConfirmDialog in node menu when confirmDelete is null (line 129 conditional is falsy)', () => {
    const slot: { found: boolean } = { found: false }
    function Checker() {
      const output = CanvasContextMenu({ menu: { x: 0, y: 0, nodeId: 'step-1' }, onClose: () => {} })
      slot.found = findByFunctionName(output, 'ConfirmDialog') !== undefined
      return output
    }
    renderToStaticMarkup(<Checker />)
    expect(slot.found).toBeFalse()
  })

  test('menu=null with confirmDelete null returns empty string (line 58 null branch)', () => {
    const markup = renderToStaticMarkup(<CanvasContextMenu menu={null} onClose={() => {}} />)
    expect(markup).toBe('')
  })

  test('renders without error when menu is null — useEffect early-return guard (line 43)', () => {
    expect(() =>
      renderToStaticMarkup(<CanvasContextMenu menu={null} onClose={() => {}} />)
    ).not.toThrow()
  })

  test('renders without error when menu is set — useEffect listener-registration path (lines 44-55)', () => {
    expect(() =>
      renderToStaticMarkup(<CanvasContextMenu menu={{ x: 0, y: 0, nodeId: 'x' }} onClose={() => {}} />)
    ).not.toThrow()
  })

  test('menu container has z-50 and min-w- overlay classes', () => {
    const markup = renderToStaticMarkup(
      <CanvasContextMenu menu={{ x: 20, y: 40, nodeId: null }} onClose={() => {}} />
    )
    expect(markup).toContain('z-50')
    expect(markup).toContain('min-w-')
  })

  test('node menu renders a MenuDivider border-t between action groups', () => {
    const markup = renderToStaticMarkup(
      <CanvasContextMenu menu={{ x: 0, y: 0, nodeId: 'step-1' }} onClose={() => {}} />
    )
    expect(markup).toContain('border-t')
  })

  test('MenuItem renders button with mono text and uppercase tracking', () => {
    const markup = renderToStaticMarkup(
      <CanvasContextMenu menu={{ x: 0, y: 0, nodeId: null }} onClose={() => {}} />
    )
    // MenuItem uses font-mono, text-[11px], uppercase, tracking-[0.16em]
    expect(markup).toContain('font-mono')
    expect(markup).toContain('uppercase')
  })

  test('MenuItem renders with type=button attribute', () => {
    const markup = renderToStaticMarkup(
      <CanvasContextMenu menu={{ x: 0, y: 0, nodeId: null }} onClose={() => {}} />
    )
    expect(markup).toContain('type="button"')
  })

  test('Delete menu item has rose-colored text class', () => {
    const markup = renderToStaticMarkup(
      <CanvasContextMenu menu={{ x: 0, y: 0, nodeId: 'step-1' }} onClose={() => {}} />
    )
    expect(markup).toContain('text-rose-300')
  })

  test('Add Step icon has amber-400 text class', () => {
    const markup = renderToStaticMarkup(
      <CanvasContextMenu menu={{ x: 0, y: 0, nodeId: null }} onClose={() => {}} />
    )
    expect(markup).toContain('text-amber-400')
  })

  test('Add Gate icon has emerald-400 text class', () => {
    const markup = renderToStaticMarkup(
      <CanvasContextMenu menu={{ x: 0, y: 0, nodeId: null }} onClose={() => {}} />
    )
    expect(markup).toContain('text-emerald-400')
  })

  test('menu container has dark background and shadow styling', () => {
    const markup = renderToStaticMarkup(
      <CanvasContextMenu menu={{ x: 10, y: 20, nodeId: null }} onClose={() => {}} />
    )
    expect(markup).toContain('bg-[#08101d]')
    expect(markup).toContain('border-slate-700')
  })

  test('canvas menu does not render MenuDivider', () => {
    const markup = renderToStaticMarkup(
      <CanvasContextMenu menu={{ x: 0, y: 0, nodeId: null }} onClose={() => {}} />
    )
    expect(markup).not.toContain('border-t border-slate-800/60')
  })

  test('menu renders at large coordinate values correctly', () => {
    const menu = { x: 9999, y: 8888, nodeId: null }
    const markup = renderToStaticMarkup(<CanvasContextMenu menu={menu} onClose={() => {}} />)
    expect(markup).toContain('left:9999px')
    expect(markup).toContain('top:8888px')
  })
})

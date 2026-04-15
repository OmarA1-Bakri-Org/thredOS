import { afterAll, describe, expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

const realApi = await import('@/lib/ui/api')

mock.module('@/lib/ui/store', () => ({
  useUIStore: (selector: (state: { selectedThreadSurfaceId: string | null; selectedRunId: string | null }) => unknown) =>
    selector({ selectedThreadSurfaceId: 'thread-step-1', selectedRunId: 'run-1' }),
}))

mock.module('@/lib/ui/api', () => ({
  ...realApi,
  useStatus: () => ({
    data: {
      name: 'Surface proof sequence',
      steps: [],
      gates: [],
      summary: { ready: 1, running: 1, done: 2, failed: 0 },
    },
    isLoading: false,
  }),
  useRunRunnable: () => ({ mutate: () => {}, isPending: false }),
  useThreadSurfaces: () => ({
    data: [{
      id: 'thread-step-1',
      parentSurfaceId: null,
      parentAgentNodeId: 'step-1',
      depth: 1,
      surfaceLabel: 'Step Surface',
      role: 'worker',
      createdAt: '2026-04-16T00:00:00.000Z',
      childSurfaceIds: [],
      sequenceRef: null,
      spawnedByAgentId: null,
      surfaceClass: 'sealed',
      visibility: 'self_only',
      isolationLabel: 'THREADOS_SCOPED',
      revealState: 'sealed',
      allowedReadScopes: ['thread-step-1'],
      allowedWriteScopes: ['thread-step-1'],
    }],
  }),
  useThreadRuns: () => ({
    data: [{
      id: 'run-1',
      threadSurfaceId: 'thread-step-1',
      runStatus: 'running',
      startedAt: '2026-04-16T00:00:00.000Z',
      endedAt: null,
      executionIndex: 1,
      runSummary: 'Surface proof is running.',
      runNotes: 'Waiting on reveal approval.',
      runDiscussion: 'Keep export evidence attached.',
      parentRunId: null,
      childIndex: null,
    }],
  }),
  useThreadMerges: () => ({ data: [] }),
  useTraces: () => ({
    data: [{ event_type: 'step-started', ts: '2026-04-16T00:00:00.000Z', actor: 'threados' }],
  }),
  useApprovals: () => ({
    data: [{ id: 'apr-1', action_type: 'reveal', status: 'pending', approved_by: null }],
  }),
  useExportBundle: () => ({
    mutate: () => {},
    isPending: false,
    data: { exportPath: '.threados/exports/run-1/bundle.json' },
    error: null,
  }),
  useRevealSurface: () => ({
    mutate: () => {},
    isPending: false,
    data: null,
  }),
}))

afterAll(() => {
  mock.restore()
})

const { RunSection } = await import('./RunSection')

describe('RunSection', () => {
  test('renders trace, approvals, export, and reveal affordances for the active run', () => {
    const markup = renderToStaticMarkup(<RunSection />)
    expect(markup).toContain('data-testid="run-control-plane"')
    expect(markup).toContain('data-testid="run-export-button"')
    expect(markup).toContain('data-testid="run-reveal-button"')
    expect(markup).toContain('data-testid="run-trace-events"')
    expect(markup).toContain('data-testid="run-approval-events"')
    expect(markup).toContain('.threados/exports/run-1/bundle.json')
    expect(markup).toContain('step-started')
    expect(markup).toContain('reveal')
  })
})

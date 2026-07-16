import { afterAll, describe, expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

const realApi = await import('@/lib/ui/api')

const runtimeRun = {
  source: 'v2' as const,
  schemaVersion: 2 as const,
  run: {
    schema_version: 2 as const,
    id: 'run-1',
    revision: 0,
    sequence_id: 'sequence-1',
    sequence_snapshot_hash: 'sha256:sequence',
    target: { kind: 'step' as const, step_id: 'step-1' },
    strategy: 'sequential' as const,
    status: 'running' as const,
    max_concurrency: 1,
    policy_snapshot_hash: 'sha256:policy',
    baseline_snapshot_id: null,
    attempt_ids: ['attempt-1'],
    created_by: 'operator',
    created_via: 'api' as const,
    created_at: '2026-04-16T00:00:00.000Z',
    started_at: '2026-04-16T00:00:00.000Z',
    ended_at: null,
    cancellation_requested_at: null,
    summary: null,
    error_code: null,
    error_message: null,
  },
  attempts: [],
}

const runtimeAttempt = {
  source: 'v2' as const,
  schemaVersion: 2 as const,
  attempt: {
    schema_version: 2 as const,
    id: 'attempt-1',
    revision: 0,
    workflow_run_id: 'run-1',
    sequence_id: 'sequence-1',
    step_id: 'step-1',
    surface_id: 'thread-step-1',
    execution_index: 1,
    attempt_number: 1,
    retry_of_attempt_id: null,
    status: 'running' as const,
    agent_ref: null,
    model: 'codex',
    side_effect_class: 'execute' as const,
    baseline_snapshot_id: null,
    workspace_id: null,
    process_id: 'process-1',
    compiled_prompt_hash: 'sha256:prompt',
    input_manifest_ref: null,
    output_manifest_ref: null,
    artifact_manifest_ref: null,
    change_set_id: null,
    gate_decision_refs: [],
    created_at: '2026-04-16T00:00:00.000Z',
    started_at: '2026-04-16T00:00:00.000Z',
    ended_at: null,
    last_heartbeat_at: '2026-04-16T00:00:01.000Z',
    exit_code: null,
    signal: null,
    duration_ms: null,
    error_code: null,
    error_message: null,
  },
  process: {
    schema_version: 1 as const,
    id: 'process-1',
    revision: 0,
    workflow_run_id: 'run-1',
    attempt_id: 'attempt-1',
    provider: 'local-process' as const,
    provider_handle: '4242',
    pid: 4242,
    command: 'agent',
    redacted_args: [],
    environment_keys: [],
    cwd: 'C:\\runtime\\surface',
    status: 'running' as const,
    launch_requested_at: '2026-04-16T00:00:00.000Z',
    started_at: '2026-04-16T00:00:00.000Z',
    ended_at: null,
    last_output_at: null,
    last_heartbeat_at: '2026-04-16T00:00:01.000Z',
    cancellation_requested_at: null,
    exit_code: null,
    signal: null,
  },
}

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
  useRuns: () => ({
    data: [{ ...runtimeRun, attempts: [runtimeAttempt.attempt] }],
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useRun: () => ({
    data: { ...runtimeRun, attempts: [runtimeAttempt.attempt] },
    isFetching: false,
    error: null,
  }),
  useRunAttempts: () => ({
    data: [runtimeAttempt],
    isFetching: false,
    error: null,
  }),
  useAttempt: () => ({ data: runtimeAttempt }),
  useCancelRun: () => ({ mutate: () => {}, isPending: false, error: null }),
  useCancelAttempt: () => ({ mutate: () => {}, isPending: false, error: null }),
  useRetryAttempt: () => ({ mutate: () => {}, isPending: false, error: null }),
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
    expect(markup).toContain('data-testid="run-trace-count"')
    expect(markup).toContain('data-testid="run-approval-count"')
    expect(markup).toContain('data-testid="run-trace-events"')
    expect(markup).toContain('data-testid="run-approval-events"')
    expect(markup).toContain('.threados/exports/run-1/bundle.json')
    expect(markup).toContain('step-started')
    expect(markup).toContain('reveal')
  })
})

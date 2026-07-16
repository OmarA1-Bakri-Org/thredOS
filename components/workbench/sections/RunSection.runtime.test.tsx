import { describe, expect, test } from 'bun:test'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AttemptProjection, RunProjection } from '@/lib/runtime/service-types'
import { RuntimeApiError } from '@/lib/ui/api'
import {
  canCancelAttempt,
  canCancelRun,
  canRetryAttempt,
  RuntimeRunConsole,
  type RuntimeRunConsoleProps,
} from './RunSection'

const NOW = '2026-07-16T00:00:00.000Z'

function runProjection(
  status: RunProjection['run']['status'] = 'running',
  source: RunProjection['source'] = 'v2',
): RunProjection {
  return {
    source,
    schemaVersion: source === 'v2' ? 2 : 1,
    run: {
      schema_version: 2,
      id: source === 'v2' ? 'workflow-run-1' : 'legacy-run-1',
      revision: 0,
      sequence_id: 'sequence-1',
      sequence_snapshot_hash: 'sha256:sequence',
      target: { kind: 'step', step_id: 'step-1' },
      strategy: 'sequential',
      status,
      max_concurrency: 1,
      policy_snapshot_hash: 'sha256:policy',
      baseline_snapshot_id: null,
      attempt_ids: [source === 'v2' ? 'attempt-1' : 'legacy-run-1:attempt:1'],
      created_by: 'operator',
      created_via: source === 'v2' ? 'api' : 'system',
      created_at: NOW,
      started_at: NOW,
      ended_at: status === 'running' ? null : NOW,
      cancellation_requested_at: null,
      summary: null,
      error_code: status === 'interrupted' ? 'PROCESS_LOST' : null,
      error_message: status === 'interrupted' ? 'process evidence disappeared' : null,
    },
    attempts: [],
  }
}

function attemptProjection(
  status: AttemptProjection['attempt']['status'] = 'running',
  processStatus: NonNullable<AttemptProjection['process']>['status'] = 'running',
  source: AttemptProjection['source'] = 'v2',
): AttemptProjection {
  const runId = source === 'v2' ? 'workflow-run-1' : 'legacy-run-1'
  const attemptId = source === 'v2' ? 'attempt-1' : 'legacy-run-1:attempt:1'
  return {
    source,
    schemaVersion: source === 'v2' ? 2 : 1,
    attempt: {
      schema_version: 2,
      id: attemptId,
      revision: 0,
      workflow_run_id: runId,
      sequence_id: 'sequence-1',
      step_id: 'step-1',
      surface_id: 'surface-1',
      execution_index: 1,
      attempt_number: 1,
      retry_of_attempt_id: null,
      status,
      agent_ref: null,
      model: 'codex',
      side_effect_class: 'execute',
      baseline_snapshot_id: null,
      workspace_id: null,
      process_id: source === 'v2' ? 'process-1' : null,
      compiled_prompt_hash: 'sha256:prompt',
      input_manifest_ref: null,
      output_manifest_ref: null,
      artifact_manifest_ref: null,
      change_set_id: null,
      gate_decision_refs: [],
      created_at: NOW,
      started_at: NOW,
      ended_at: status === 'running' ? null : NOW,
      last_heartbeat_at: NOW,
      exit_code: null,
      signal: null,
      duration_ms: status === 'running' ? null : 42,
      error_code: status === 'interrupted' ? 'PROCESS_LOST' : null,
      error_message: status === 'interrupted' ? 'process evidence disappeared' : null,
    },
    process: source === 'v2' ? {
      schema_version: 1,
      id: 'process-1',
      revision: 0,
      workflow_run_id: runId,
      attempt_id: attemptId,
      provider: 'local-process',
      provider_handle: null,
      pid: processStatus === 'lost' ? null : 4242,
      command: 'agent',
      redacted_args: [],
      environment_keys: [],
      cwd: 'C:\\runtime\\surface-1',
      status: processStatus,
      launch_requested_at: NOW,
      started_at: NOW,
      ended_at: processStatus === 'running' ? null : NOW,
      last_output_at: NOW,
      last_heartbeat_at: NOW,
      cancellation_requested_at: null,
      exit_code: null,
      signal: null,
    } : null,
  }
}

function baseProps(overrides: Partial<RuntimeRunConsoleProps> = {}): RuntimeRunConsoleProps {
  const run = runProjection()
  const attempt = attemptProjection()
  run.attempts = [attempt.attempt]
  return {
    runs: [run],
    activeRun: run,
    attempts: [attempt],
    activeAttempt: attempt,
    isLoading: false,
    isRefreshing: false,
    queryError: null,
    controlError: null,
    runAllPending: false,
    cancelRunPending: false,
    cancelAttemptPending: false,
    retryAttemptPending: false,
    onRunAll: () => {},
    onCancelRun: () => {},
    onCancelAttempt: () => {},
    onRetryAttempt: () => {},
    onSelectRun: () => {},
    onSelectAttempt: () => {},
    ...overrides,
  }
}

function findByTestId(node: ReactNode, testId: string): ReactElement<Record<string, unknown>> {
  if (isValidElement<Record<string, unknown>>(node)) {
    if (node.props['data-testid'] === testId) return node
    const children = node.props.children
    const list = Array.isArray(children) ? children : [children]
    for (const child of list) {
      try {
        return findByTestId(child as ReactNode, testId)
      } catch {
        // Continue walking sibling nodes.
      }
    }
  }
  throw new Error(`Could not find ${testId}`)
}

describe('RunSection canonical runtime controls', () => {
  test('enables controls only for valid canonical transitions', () => {
    expect(canCancelRun(runProjection('running'))).toBe(true)
    expect(canCancelRun(runProjection('successful'))).toBe(false)
    expect(canCancelRun(runProjection('running', 'legacy'))).toBe(false)

    expect(canCancelAttempt(attemptProjection('running', 'running'))).toBe(true)
    expect(canCancelAttempt(attemptProjection('running', 'lost'))).toBe(false)
    expect(canCancelAttempt(attemptProjection('interrupted', 'lost'))).toBe(false)
    expect(canCancelAttempt(attemptProjection('running', 'running', 'legacy'))).toBe(false)

    expect(canRetryAttempt(attemptProjection('interrupted', 'lost'))).toBe(true)
    expect(canRetryAttempt(attemptProjection('completed', 'exited'))).toBe(true)
    expect(canRetryAttempt(attemptProjection('running', 'running'))).toBe(false)
    expect(canRetryAttempt(attemptProjection('failed', 'exited', 'legacy'))).toBe(false)
  })

  test('canonical buttons invoke workflow-run and attempt resource actions with distinct IDs', () => {
    const calls: string[] = []
    const tree = RuntimeRunConsole(baseProps({
      onCancelRun: runId => calls.push(`run:${runId}`),
      onCancelAttempt: attemptId => calls.push(`cancel:${attemptId}`),
      onRetryAttempt: attemptId => calls.push(`retry:${attemptId}`),
    }))

    const cancelRun = findByTestId(tree, 'cancel-run-button')
    const cancelAttempt = findByTestId(tree, 'cancel-attempt-button')
    const retryAttempt = findByTestId(tree, 'retry-attempt-button')
    ;(cancelRun.props.onClick as () => void)()
    ;(cancelAttempt.props.onClick as () => void)()

    const terminalAttempt = attemptProjection('interrupted', 'lost')
    const retryTree = RuntimeRunConsole(baseProps({
      activeAttempt: terminalAttempt,
      attempts: [terminalAttempt],
      onRetryAttempt: attemptId => calls.push(`retry:${attemptId}`),
    }))
    ;(findByTestId(retryTree, 'retry-attempt-button').props.onClick as () => void)()

    expect(retryAttempt.props.disabled).toBe(true)
    expect(calls).toEqual([
      'run:workflow-run-1',
      'cancel:attempt-1',
      'retry:attempt-1',
    ])
  })

  test('renders workflow and attempt identity separately with truthful lost and interrupted states', () => {
    const run = runProjection('interrupted')
    const attempt = attemptProjection('interrupted', 'lost')
    run.attempts = [attempt.attempt]
    const markup = renderToStaticMarkup(
      <RuntimeRunConsole {...baseProps({
        runs: [run],
        activeRun: run,
        attempts: [attempt],
        activeAttempt: attempt,
      })} />,
    )

    expect(markup).toContain('Workflow run')
    expect(markup).toContain('workflow-run-1')
    expect(markup).toContain('Selected attempt')
    expect(markup).toContain('attempt-1')
    expect(markup).toContain('attempt · interrupted')
    expect(markup).toContain('process · lost')
    expect(markup).toContain('PROCESS_LOST')
  })

  test('keeps legacy runs visible and read-only with an explicit badge', () => {
    const run = runProjection('successful', 'legacy')
    const attempt = attemptProjection('completed', 'exited', 'legacy')
    run.attempts = [attempt.attempt]
    const markup = renderToStaticMarkup(
      <RuntimeRunConsole {...baseProps({
        runs: [run],
        activeRun: run,
        attempts: [attempt],
        activeAttempt: attempt,
      })} />,
    )

    expect(markup).toContain('legacy · read only')
    expect(markup).toContain('legacy-run-1')
    expect(markup).toContain('legacy-run-1:attempt:1')
    expect(markup).toContain('data-testid="cancel-run-button"')
    expect(markup).toContain('disabled=""')
  })

  test('renders typed control failures without changing the supplied canonical status', () => {
    const error = new RuntimeApiError(
      'attempt attempt-1 is interrupted',
      'ATTEMPT_NOT_RUNNING',
      409,
      'cancel-1',
    )
    const markup = renderToStaticMarkup(
      <RuntimeRunConsole {...baseProps({ controlError: error })} />,
    )

    expect(markup).toContain('role="alert"')
    expect(markup).toContain('ATTEMPT_NOT_RUNNING')
    expect(markup).toContain('attempt attempt-1 is interrupted')
    expect(markup).toContain('attempt · running')
    expect(markup).toContain('process · running')
  })
})

import { expect, test, type Page, type Route } from '@playwright/test'
import type { ChangeSetSummary } from '@/lib/changesets/diff'
import {
  openAccordionSection,
  openAuthenticatedWorkbench,
  startBrowserEvidence,
} from './helpers/verification'

const NOW = '2026-09-29T00:00:00.000Z'
const RUN_ID = 'run-review-ui'
const FIRST_ATTEMPT = 'attempt-review-a'
const SECOND_ATTEMPT = 'attempt-review-b'
const FIRST_CHANGE_SET = 'change-review-a'
const SECOND_CHANGE_SET = 'change-review-b'

const attempt = {
  schema_version: 2, id: FIRST_ATTEMPT, revision: 1, workflow_run_id: RUN_ID,
  sequence_id: 'sequence-review-ui', step_id: 'step-review', surface_id: 'surface-review',
  execution_index: 1, attempt_number: 1, retry_of_attempt_id: null, status: 'completed',
  agent_ref: 'agent-review', model: 'codex', side_effect_class: 'execute',
  baseline_snapshot_id: 'snapshot-review', workspace_id: 'workspace-review-a',
  process_id: 'process-review-a', compiled_prompt_hash: 'sha256:prompt',
  input_manifest_ref: 'snapshot-review/manifest.json', output_manifest_ref: null,
  artifact_manifest_ref: null, change_set_id: FIRST_CHANGE_SET, gate_decision_refs: [],
  created_at: NOW, started_at: NOW, ended_at: NOW, last_heartbeat_at: NOW,
  exit_code: 0, signal: null, duration_ms: 1200, error_code: null, error_message: null,
}

const runProjection = {
  source: 'v2', schemaVersion: 2,
  run: {
    schema_version: 2, id: RUN_ID, revision: 1, sequence_id: 'sequence-review-ui',
    sequence_snapshot_hash: 'sha256:sequence', target: { kind: 'step', step_id: 'step-review' },
    strategy: 'sequential', status: 'successful', max_concurrency: 1,
    policy_snapshot_hash: 'sha256:policy', baseline_snapshot_id: 'snapshot-review',
    attempt_ids: [FIRST_ATTEMPT], created_by: 'operator', created_via: 'api',
    created_at: NOW, started_at: NOW, ended_at: NOW, cancellation_requested_at: null,
    summary: 'Change Set review fixture', error_code: null, error_message: null,
  },
  attempts: [attempt],
}

const attemptProjection = {
  source: 'v2', schemaVersion: 2, attempt,
  process: {
    schema_version: 1, id: 'process-review-a', revision: 1, workflow_run_id: RUN_ID,
    attempt_id: FIRST_ATTEMPT, provider: 'local-process', provider_handle: '4242',
    pid: 4242, command: 'agent', redacted_args: [], environment_keys: [],
    cwd: 'C:\\threados-runtime\\workspace-review-a', status: 'exited',
    launch_requested_at: NOW, started_at: NOW, ended_at: NOW, last_output_at: NOW,
    last_heartbeat_at: NOW, cancellation_requested_at: null, exit_code: 0, signal: null,
  },
}

function summary(id: string, attemptId: string, revision: number): ChangeSetSummary {
  return {
    schema_version: 1, id, revision, workflow_run_id: RUN_ID, attempt_id: attemptId,
    step_id: 'step-review', surface_id: 'surface-review', agent_ref: 'agent-review',
    workspace_id: id === FIRST_CHANGE_SET ? 'workspace-review-a' : 'workspace-review-b',
    baseline_snapshot_id: 'snapshot-review', change_set_root_hash: 'sha256:' + 'a'.repeat(64),
    created_at: NOW, status: 'captured', entry_count: id === FIRST_CHANGE_SET ? 3 : 1,
    total_bytes: id === FIRST_CHANGE_SET ? 128 : 12,
    path_scope_violations: id === FIRST_CHANGE_SET ? ['src/outside-scope.ts'] : [],
    validation: { status: id === FIRST_CHANGE_SET ? 'failed' : 'pending', evidence_refs: ['tests/review.txt'], required_commands: 0 },
    output_contract_state: id === FIRST_CHANGE_SET ? 'failed' : 'pending',
    approval_state: 'pending', decision: null,
  }
}

const firstEntries = [
  {
    path: 'src/hello.ts', operation: 'modify', before_sha256: 'sha256:' + 'b'.repeat(64),
    after_sha256: 'sha256:' + 'c'.repeat(64), content_kind: 'text',
    size_bytes_before: 6, size_bytes_after: 6, lines_added: 1, lines_deleted: 1,
    patch_ref: null, content_ref: null, before_text: 'before', after_text: 'after',
    unified_diff: '--- a/src/hello.ts\n+++ b/src/hello.ts\n-before\n+after',
    preview_truncated: false,
  },
  {
    path: 'assets/logo.png', operation: 'add', before_sha256: null,
    after_sha256: 'sha256:' + 'd'.repeat(64), content_kind: 'binary',
    size_bytes_before: 0, size_bytes_after: 114, lines_added: null, lines_deleted: null,
    patch_ref: null, content_ref: null, before_text: null, after_text: null,
    unified_diff: null, preview_truncated: false,
  },
  {
    path: 'src/large.txt', operation: 'modify', before_sha256: 'sha256:' + 'e'.repeat(64),
    after_sha256: 'sha256:' + 'f'.repeat(64), content_kind: 'text',
    size_bytes_before: 100_000, size_bytes_after: 100_001, lines_added: null, lines_deleted: null,
    patch_ref: null, content_ref: null, before_text: null, after_text: null,
    unified_diff: null, preview_truncated: true,
  },
]

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function installReviewRoutes(page: Page, decisionRequests: Array<{ path: string; body: unknown }>) {
  const candidates = [
    summary(FIRST_CHANGE_SET, FIRST_ATTEMPT, 4),
    summary(SECOND_CHANGE_SET, SECOND_ATTEMPT, 7),
  ]
  let staleDecisionPending = true

  await page.route('**/api/runs', route => fulfillJson(route, { runs: [runProjection] }))
  await page.route(`**/api/runs/${RUN_ID}`, route => fulfillJson(route, runProjection))
  await page.route(`**/api/runs/${RUN_ID}/attempts`, route => fulfillJson(route, {
    runId: RUN_ID, source: 'v2', schemaVersion: 2, attempts: [attemptProjection],
  }))
  await page.route(`**/api/attempts/${FIRST_ATTEMPT}`, route => fulfillJson(route, attemptProjection))
  await page.route(`**/api/traces?runId=${RUN_ID}`, route => fulfillJson(route, { events: [] }))
  await page.route(`**/api/approvals?runId=${RUN_ID}`, route => fulfillJson(route, { approvals: [] }))
  await page.route(`**/api/change-sets?run_id=${RUN_ID}`, route => fulfillJson(route, {
    schema_version: 1, change_sets: candidates,
  }))
  for (const id of [FIRST_CHANGE_SET, SECOND_CHANGE_SET]) {
    await page.route(`**/api/change-sets/${id}`, route => fulfillJson(route, {
      schema_version: 1,
      summary: candidates.find(item => item.id === id),
      entries: id === FIRST_CHANGE_SET ? firstEntries : [firstEntries[0]],
      file_tree_truncated: id === FIRST_CHANGE_SET,
      test_evidence_refs: ['tests/review.txt'],
    }))
  }
  await page.route(`**/api/change-sets/${FIRST_CHANGE_SET}/select`, async route => {
    const body = route.request().postDataJSON() as unknown
    decisionRequests.push({ path: route.request().url(), body })
    candidates[0] = { ...candidates[0]!, revision: 5, status: 'selected',
      decision: { action: 'select', actor: 'operator', idempotency_key: 'select-review-a',
        expected_revision: 4, decided_at: NOW, reason: null } }
    await fulfillJson(route, { schema_version: 1, change_set: candidates[0] })
  })
  await page.route(`**/api/change-sets/${SECOND_CHANGE_SET}/reject`, async route => {
    const body = route.request().postDataJSON() as unknown
    decisionRequests.push({ path: route.request().url(), body })
    if (staleDecisionPending) {
      staleDecisionPending = false
      await fulfillJson(route, { code: 'CHANGE_SET_REVISION_CONFLICT', error: 'Revision has changed' }, 409)
      return
    }
    candidates[1] = { ...candidates[1]!, revision: 8, status: 'rejected',
      decision: { action: 'reject', actor: 'operator', idempotency_key: 'reject-review-b',
        expected_revision: 7, decided_at: NOW, reason: 'Insufficient validation evidence' } }
    await fulfillJson(route, { schema_version: 1, change_set: candidates[1] })
  })
  await page.route(`**/api/change-sets/compare?*`, route => fulfillJson(route, {
    schema_version: 1, left: candidates[0], right: candidates[1],
    paths: [{ path: 'src/hello.ts', relation: 'different' }], truncated: false,
  }))
}

test('operator reviews isolated candidates, records preferences, and sees a stale revision', async ({ page }, testInfo) => {
  const evidence = startBrowserEvidence(page, testInfo, 'change-set-review')
  const decisionRequests: Array<{ path: string; body: unknown }> = []
  const mutationRequests: string[] = []
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().includes('/api/change-sets/')) {
      mutationRequests.push(new URL(request.url()).pathname)
    }
  })
  await installReviewRoutes(page, decisionRequests)

  try {
    await evidence.withinBoundary('UI', 'open a captured Change Set in the selected run', async () => {
      await openAuthenticatedWorkbench(page)
      await openAccordionSection(page, 'run')
      const inspector = page.getByTestId('change-set-inspector')
      await expect(inspector).toBeVisible()
      await expect(inspector.getByTestId('change-set-candidate')).toHaveCount(2)
      await expect(inspector.getByTestId('change-set-review-details')).toBeVisible()
    })

    const inspector = page.getByTestId('change-set-inspector')
    await evidence.withinBoundary('response -> UI', 'show bounded changes, scope, validation, and provenance', async () => {
      const details = inspector.getByTestId('change-set-review-details')
      await expect(details.getByTestId('change-set-diff')).toContainText('-before')
      await expect(details.getByText('File list is truncated; remaining files are not shown here.')).toBeVisible()
      await expect(details.getByText('src/outside-scope.ts')).toBeVisible()
      await expect(details.getByText('tests/review.txt')).toBeVisible()
      await expect(details.getByText('snapshot-review')).toBeVisible()
      await expect(details.getByText('agent-review')).toBeVisible()
      await inspector.getByRole('button', { name: 'assets/logo.png' }).click()
      await expect(details.getByText(/Binary content · 0 → 114 bytes/)).toBeVisible()
      await inspector.getByRole('button', { name: 'src/large.txt' }).click()
      await expect(details.getByText('Text preview is truncated or unavailable.')).toBeVisible()
      await inspector.getByLabel('Compare with candidate').selectOption(SECOND_ATTEMPT)
      await expect(inspector.getByTestId('change-set-comparison')).toContainText('src/hello.ts · different')
      await expect(details.getByText('Selection records a preference. It does not approve or apply changes to the project.')).toBeVisible()
    })

    await evidence.withinBoundary('client -> API', 'select with the reviewed revision without applying files', async () => {
      await inspector.getByRole('button', { name: 'Select candidate' }).click()
      await expect(inspector.getByText('Candidate selected for later merge review.')).toBeVisible()
      expect(decisionRequests[0]?.body).toEqual({ expected_revision: 4 })
      expect(mutationRequests).toEqual([`/api/change-sets/${FIRST_CHANGE_SET}/select`])
    })

    await evidence.withinBoundary('client -> API', 'reject another candidate and surface a stale revision', async () => {
      await inspector.getByTestId('change-set-candidate').nth(1).click()
      await expect(inspector.getByTestId('change-set-review-details')).toBeVisible()
      await inspector.getByLabel('Reason to reject').fill('Insufficient validation evidence')
      await inspector.getByRole('button', { name: 'Reject candidate' }).click()
      await expect(inspector.getByRole('alert')).toContainText('The review changed; reload it before deciding.')
      expect(decisionRequests[1]?.body).toEqual({
        expected_revision: 7, reason: 'Insufficient validation evidence',
      })
      await expect(inspector.getByText('Candidate rejected.')).toHaveCount(0)
      await inspector.getByRole('button', { name: 'Reject candidate' }).click()
      await expect(inspector.getByText('Candidate rejected.')).toBeVisible()
      expect(decisionRequests[2]?.body).toEqual({
        expected_revision: 7, reason: 'Insufficient validation evidence',
      })
      expect(mutationRequests).toEqual([
        `/api/change-sets/${FIRST_CHANGE_SET}/select`,
        `/api/change-sets/${SECOND_CHANGE_SET}/reject`,
        `/api/change-sets/${SECOND_CHANGE_SET}/reject`,
      ])
    })
  } finally {
    await evidence.finalize()
  }
})

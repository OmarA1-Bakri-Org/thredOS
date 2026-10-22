import { expect, test, type Page, type Route } from '@playwright/test'
import { realpath } from 'fs/promises'
import { isAbsolute, join, relative, sep } from 'path'
import { updateAgentState } from '@/lib/agents/repository'
import { buildAgentComposition } from '@/lib/agents/composition'
import { resolveStepAgent, type AgentExecutionSnapshot } from '@/lib/agents/execution'
import { StepSchema } from '@/lib/sequence/schema'
import {
  openAccordionSection,
  openAuthenticatedWorkbench,
  startBrowserEvidence,
} from './helpers/verification'

const NOW = '2026-09-28T00:00:00.000Z'

const attempt = {
  schema_version: 2,
  id: 'attempt-ui-1',
  revision: 1,
  workflow_run_id: 'run-ui-1',
  sequence_id: 'sequence-ui-1',
  step_id: 'orch-orchestrator',
  surface_id: 'thread-orch-orchestrator',
  execution_index: 1,
  attempt_number: 1,
  retry_of_attempt_id: null,
  status: 'completed',
  agent_ref: 'agent-workspace-render-fixture',
  agent_registration: undefined as AgentExecutionSnapshot | undefined,
  model: 'codex',
  side_effect_class: 'execute',
  baseline_snapshot_id: 'snapshot-ui-1',
  workspace_id: 'workspace-ui-1',
  process_id: 'process-ui-1',
  compiled_prompt_hash: 'sha256:prompt',
  input_manifest_ref: 'snapshot-ui-1/manifest.json',
  output_manifest_ref: null,
  artifact_manifest_ref: null,
  change_set_id: null,
  gate_decision_refs: [],
  created_at: NOW,
  started_at: NOW,
  ended_at: NOW,
  last_heartbeat_at: NOW,
  exit_code: 0,
  signal: null,
  duration_ms: 1200,
  error_code: null,
  error_message: null,
}

const processRecord = {
  schema_version: 1,
  id: 'process-ui-1',
  revision: 1,
  workflow_run_id: 'run-ui-1',
  attempt_id: 'attempt-ui-1',
  provider: 'local-process',
  provider_handle: '4242',
  pid: 4242,
  command: 'agent',
  redacted_args: [],
  environment_keys: [],
  cwd: 'C:\\threados-runtime\\workspace-ui-1',
  status: 'exited',
  launch_requested_at: NOW,
  started_at: NOW,
  ended_at: NOW,
  last_output_at: NOW,
  last_heartbeat_at: NOW,
  cancellation_requested_at: null,
  exit_code: 0,
  signal: null,
}

const runProjection = {
  source: 'v2',
  schemaVersion: 2,
  run: {
    schema_version: 2,
    id: 'run-ui-1',
    revision: 1,
    sequence_id: 'sequence-ui-1',
    sequence_snapshot_hash: 'sha256:sequence',
    target: { kind: 'step', step_id: 'orch-orchestrator' },
    strategy: 'sequential',
    status: 'successful',
    max_concurrency: 1,
    policy_snapshot_hash: 'sha256:policy',
    baseline_snapshot_id: 'snapshot-ui-1',
    attempt_ids: ['attempt-ui-1'],
    agent_registrations: {} as Record<string, AgentExecutionSnapshot>,
    created_by: 'operator',
    created_via: 'api',
    created_at: NOW,
    started_at: NOW,
    ended_at: NOW,
    cancellation_requested_at: null,
    summary: 'Workspace inspection fixture',
    error_code: null,
    error_message: null,
  },
  attempts: [attempt],
}

const attemptProjection = {
  source: 'v2',
  schemaVersion: 2,
  attempt,
  process: processRecord,
}

const workspace = {
  schema_version: 1,
  id: 'workspace-ui-1',
  revision: 2,
  workflow_run_id: 'run-ui-1',
  attempt_id: 'attempt-ui-1',
  surface_id: 'thread-orch-orchestrator',
  snapshot_id: 'snapshot-ui-1',
  provider: 'copy',
  isolation_label: 'THREADOS_SCOPED',
  root_path: 'C:\\threados-runtime\\workspace-ui-1',
  status: 'retained',
  retention_policy: 'retain_until_applied',
  manifest_hash: 'a'.repeat(64),
  file_count: 8,
  total_bytes: 4096,
  reserved_bytes: 4096,
  created_at: NOW,
  ready_at: NOW,
  cleaned_at: null,
  error_code: null,
}

function workspaceInspection(status: 'retained' | 'cleaned' = 'retained') {
  return {
    schema_version: 1,
    workspace: status === 'retained' ? workspace : {
      ...workspace,
      revision: 3,
      status: 'cleaned',
      reserved_bytes: 0,
      cleaned_at: NOW,
    },
    snapshot: {
      id: 'snapshot-ui-1',
      status: 'ready',
      root_manifest_hash: 'b'.repeat(64),
      file_count: 8,
      total_bytes: 4096,
      created_at: NOW,
      verified_at: NOW,
    },
    manifest_hash: 'a'.repeat(64),
    attempt: {
      id: attempt.id,
      status: attempt.status,
      step_id: attempt.step_id,
      workflow_run_id: attempt.workflow_run_id,
    },
    processes: [{
      id: processRecord.id,
      attempt_id: processRecord.attempt_id,
      status: processRecord.status,
      pid: processRecord.pid,
      exit_code: processRecord.exit_code,
      started_at: processRecord.started_at,
      ended_at: processRecord.ended_at,
    }],
    verification: status === 'retained'
      ? { exists: true, manifestMatches: false, hasUsefulOutput: true }
      : { exists: false, manifestMatches: null, hasUsefulOutput: null },
    bootstrap: [{ index: 0, status: 'success', duration_ms: 30, exit_code: 0 }],
    diagnostics: [],
  }
}

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
}

async function installWorkspaceRoutes(page: Page) {
  await page.route('**/api/runs', route => fulfillJson(route, { runs: [runProjection] }))
  await page.route('**/api/runs/run-ui-1', route => fulfillJson(route, runProjection))
  await page.route('**/api/runs/run-ui-1/attempts', route => fulfillJson(route, {
    runId: 'run-ui-1',
    source: 'v2',
    schemaVersion: 2,
    attempts: [attemptProjection],
  }))
  await page.route('**/api/attempts/attempt-ui-1', route => fulfillJson(route, attemptProjection))
  await page.route('**/api/traces?runId=run-ui-1', route => fulfillJson(route, { events: [] }))
  await page.route('**/api/approvals?runId=run-ui-1', route => fulfillJson(route, { approvals: [] }))
  await page.route('**/api/workspaces/workspace-ui-1', route => fulfillJson(route, workspaceInspection()))
  await page.route('**/api/workspaces/workspace-ui-1/clean', route => fulfillJson(route, workspaceInspection('cleaned')))
}

async function registerRenderFixture(): Promise<AgentExecutionSnapshot> {
  const basePath = await realpath(process.env.THREDOS_BASE_PATH ?? '')
  const proofRoot = await realpath(join(process.cwd(), 'test-results', 'verify'))
  const within = relative(proofRoot, basePath)
  if (!within || isAbsolute(within) || within === '..' || within.startsWith(`..${sep}`) || !basePath.endsWith(`${sep}workspace`)) {
    throw new Error('Workspace rendering registration requires an owned verification fixture')
  }
  const promptRef = { id: 'orch-orchestrator', version: 1, path: '.threados/prompts/orch-orchestrator.md' }
  const agent = {
    id: 'agent-workspace-render-fixture', name: 'Workspace rendering fixture',
    builderId: 'workspace-render-builder', builderName: 'Workspace rendering fixture',
    registeredAt: NOW, threadSurfaceIds: [], version: 1, model: 'codex', role: 'orchestrator',
    promptRef, skillRefs: [], tools: [],
    composition: buildAgentComposition({ model: 'codex', role: 'orchestrator', promptRef, skillRefs: [], tools: [] }),
  }
  await updateAgentState(basePath, state => ({ ...state,
    agents: [...state.agents.filter(item => item.id !== agent.id), agent],
  }))
  const step = StepSchema.parse({ id: 'orch-orchestrator', name: 'Workspace rendering fixture', type: 'base',
    model: agent.model, role: agent.role, prompt_ref: promptRef, prompt_file: promptRef.path,
    skill_refs: [], assigned_agent_id: agent.id, agent_ref: agent.id,
  })
  return (await resolveStepAgent(basePath, step)).registration
}

test('an operator renders mocked workspace evidence and confirms the cleanup request', async ({ page }, testInfo) => {
  const registration = await registerRenderFixture()
  attempt.agent_ref = registration.registration_id
  attempt.agent_registration = registration
  runProjection.run.agent_registrations = { 'orch-orchestrator': registration }
  const evidence = startBrowserEvidence(page, testInfo, 'workspace-inspector')
  await installWorkspaceRoutes(page)

  try {
    await evidence.withinBoundary('UI', 'open the workspace attached to the selected attempt', async () => {
      await openAuthenticatedWorkbench(page)
      await openAccordionSection(page, 'run')
      await expect(page.getByText('workspace-ui-1').first()).toBeVisible()
      await page.getByTestId('inspect-workspace-button').click()
      await expect(page.getByTestId('workspace-inspector')).toBeVisible()
    })

    await evidence.withinBoundary('response -> UI', 'show verified workspace and isolation evidence', async () => {
      const inspector = page.getByTestId('workspace-inspector')
      await expect(inspector.getByText('THREADOS_SCOPED')).toBeVisible()
      await expect(inspector.getByText('Directory-scoped isolation; the host does not enforce this boundary.')).toBeVisible()
      await expect(inspector.getByText('Matches baseline')).toBeVisible()
      await expect(inspector.getByText('process-ui-1', { exact: false })).toBeVisible()
      await expect(inspector.getByText('Command 1', { exact: false })).toBeVisible()
      await expect(inspector.getByRole('button', { name: 'Open in Explorer' })).toBeDisabled()
      await expect(inspector.getByText('Explorer is available in Desktop for a verified workspace. Terminal launch is unavailable.')).toBeVisible()
    })

    await evidence.withinBoundary('client -> API', 'confirm destructive cleanup through the workspace service', async () => {
      const request = page.waitForRequest(item =>
        item.url().endsWith('/api/workspaces/workspace-ui-1/clean') && item.method() === 'POST',
      )
      await page.getByRole('button', { name: 'Clean workspace' }).click()
      await expect(page.getByTestId('confirm-dialog')).toBeVisible()
      await page.getByRole('button', { name: 'Delete workspace files' }).click()
      await request
    })

    await expect(page.getByText('Workspace files have been cleaned; canonical runtime records remain available.')).toBeVisible()
  } finally {
    await evidence.finalize()
  }
})

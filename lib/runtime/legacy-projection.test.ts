import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { LegacyRunRecordSchema, projectLegacyRunRecord } from './legacy-projection'
import { generateExportBundle } from '../exports/bundler'
import { AttemptRepository } from './attempt-repository'
import { RunRepository } from './run-repository'
import type { StepAttempt, WorkflowRun } from './schema'

const timestamp = '2026-07-16T00:00:00.000Z'

const legacy = {
  id: 'legacy-run-01', sequence_id: 'sequence-01', step_id: 'step-01', surface_id: 'surface-01',
  attempt: 1, status: 'successful' as const, executor: 'threados', model: 'codex',
  policy_snapshot_hash: 'sha256:policy', compiled_prompt_hash: 'sha256:prompt',
  input_manifest_ref: null, artifact_manifest_ref: null, started_at: timestamp, ended_at: timestamp,
  timing_summary: { duration_ms: 20 }, cost_summary: null,
}

describe('legacy projection and additive export discovery', () => {
  let basePath: string
  beforeEach(async () => { basePath = await mkdtemp(join(tmpdir(), 'threados-legacy-projection-')) })
  afterEach(async () => { await rm(basePath, { recursive: true, force: true }) })

  test.each(['pending', 'running', 'successful', 'failed', 'cancelled'] as const)(
    'projects legacy status %s without rewriting source bytes',
    async status => {
      const record = LegacyRunRecordSchema.parse({ ...legacy, status })
      const before = JSON.stringify(record)
      const projection = projectLegacyRunRecord(record)
      expect(JSON.stringify(record)).toBe(before)
      expect(projection.workflowRun.id).toBe(record.id)
      expect(projection.stepAttempt.workflow_run_id).toBe(record.id)
      expect(projection.processRecord).toBeNull()
    },
  )

  test('discovers legacy and V2 exports with explicit source and schema version', async () => {
    const legacyDir = join(basePath, '.threados/runs/legacy-run-01')
    await mkdir(legacyDir, { recursive: true })
    await writeFile(join(legacyDir, 'run.json'), JSON.stringify(legacy), 'utf-8')
    const legacyBytes = await readFile(join(legacyDir, 'run.json'), 'utf-8')
    const legacyBundle = await generateExportBundle(basePath, legacy.id)
    expect(legacyBundle).toMatchObject({ run_source: 'legacy', run_schema_version: 1 })
    expect(legacyBundle.attempts).toHaveLength(1)
    expect(await readFile(join(legacyDir, 'run.json'), 'utf-8')).toBe(legacyBytes)

    const workflow: WorkflowRun = {
      schema_version: 2, id: 'run-v2', revision: 0, sequence_id: 'sequence-01',
      sequence_snapshot_hash: 'sha256:sequence', target: { kind: 'runnable' }, strategy: 'sequential',
      status: 'pending', max_concurrency: 1, policy_snapshot_hash: 'sha256:policy', baseline_snapshot_id: null,
      attempt_ids: [], created_by: 'operator', created_via: 'cli', created_at: timestamp, started_at: null,
      ended_at: null, cancellation_requested_at: null, summary: null, error_code: null, error_message: null,
    }
    const attempt: StepAttempt = {
      schema_version: 2, id: 'attempt-v2', revision: 0, workflow_run_id: workflow.id,
      sequence_id: workflow.sequence_id, step_id: 'step-01', surface_id: 'surface-01', execution_index: 1,
      attempt_number: 1, retry_of_attempt_id: null, status: 'pending', agent_ref: null, model: 'codex',
      side_effect_class: 'write', baseline_snapshot_id: null, workspace_id: null, process_id: null,
      compiled_prompt_hash: 'sha256:prompt', input_manifest_ref: null, output_manifest_ref: null,
      artifact_manifest_ref: null, change_set_id: null, gate_decision_refs: [], created_at: timestamp,
      started_at: null, ended_at: null, last_heartbeat_at: null, exit_code: null, signal: null,
      duration_ms: null, error_code: null, error_message: null,
    }
    await new RunRepository(basePath).create(workflow)
    await new AttemptRepository(basePath).create(attempt)
    const v2Bundle = await generateExportBundle(basePath, workflow.id)
    expect(v2Bundle).toMatchObject({ run_source: 'v2', run_schema_version: 2 })
    expect(v2Bundle.attempts.map(item => item.id)).toEqual(['attempt-v2'])
  })
})

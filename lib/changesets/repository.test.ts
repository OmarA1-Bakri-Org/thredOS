import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { hashCanonicalJson } from '../workspaces/hash'
import { createSnapshotManifest } from '../workspaces/manifest'
import { ChangeSetRepository } from './repository'
import type { ChangeSet } from './schema'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

test('select and reject use expected revision and preserve captured bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'threados-change-review-'))
  roots.push(root)
  const canonicalRoot = join(root, 'canonical')
  const runtimeDataRoot = join(root, 'runtime')
  await Promise.all([mkdir(canonicalRoot), mkdir(runtimeDataRoot)])
  const manifest = createSnapshotManifest('snapshot-1', [])
  const semantic = {
    baseline_snapshot_id: manifest.snapshot_id,
    baseline_manifest_hash: manifest.root_manifest_hash,
    final_workspace_manifest_hash: manifest.root_manifest_hash,
    entries: [], validation_commands_required: 0, path_scopes: null, path_scope_violations: [],
  }
  const record: ChangeSet = {
    schema_version: 2, revision: 0, id: 'change-set-attempt-1', workflow_run_id: 'run-1',
    attempt_id: 'attempt-1', step_id: 'step-1', surface_id: 'surface-1', agent_ref: null,
    workspace_id: 'workspace-1', baseline_snapshot_id: manifest.snapshot_id,
    baseline_manifest_hash: manifest.root_manifest_hash,
    final_workspace_manifest_ref: '.threados/changesets/change-set-attempt-1.manifest.json',
    final_workspace_manifest_hash: manifest.root_manifest_hash,
    change_set_root_hash: hashCanonicalJson(semantic), created_at: '2026-09-29T00:00:00.000Z',
    entries: [], total_bytes: 0, total_lines_added: null, total_lines_deleted: null,
    path_scopes: null, path_scope_violations: [], validation: { status: 'pending', evidence_refs: [], required_commands: 0 },
    output_contract_state: 'pending', approval_state: 'pending', status: 'captured', decision: null,
  }
  const repo = new ChangeSetRepository({
    canonicalRoot, runtimeDataRoot, namespace: 'local', runId: 'run-1', attemptId: 'attempt-1',
  })
  await repo.create(record, manifest)
  const selected = await repo.update(record.id, 0, current => ({
    ...current, status: 'selected', decision: {
      action: 'select', actor: 'operator', idempotency_key: 'choice-1',
      expected_revision: 0, decided_at: '2026-09-29T01:00:00.000Z', reason: null,
    },
  }))
  expect(selected).toMatchObject({ revision: 1, status: 'selected', change_set_root_hash: record.change_set_root_hash })
  await expect(repo.update(record.id, 0, current => ({ ...current, status: 'rejected' })))
    .rejects.toMatchObject({ code: 'CHANGE_SET_REVISION_CONFLICT' })
  expect((await repo.get(record.id))?.status).toBe('selected')
  const { validation_commands_required: _count, ...oldSemantic } = semantic
  const legacy = { ...record, schema_version: 1,
    validation: { status: 'pending', evidence_refs: [] },
    change_set_root_hash: hashCanonicalJson(oldSemantic) }
  await writeFile(join(canonicalRoot, '.threados', 'changesets', `${record.id}.json`), JSON.stringify(legacy))
  await expect(repo.get(record.id)).rejects.toMatchObject({ code: 'CHANGE_SET_SCHEMA_UPGRADE_REQUIRED' })
  await expect(repo.create(record, manifest)).rejects.toMatchObject({ code: 'CHANGE_SET_SCHEMA_UPGRADE_REQUIRED' })
})

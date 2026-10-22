import { createHash } from 'crypto'
import { link, lstat, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, dirname, join, resolve } from 'path'
import { afterEach, describe, expect, test } from 'bun:test'
import { createDefaultWorkspaceConfig } from '../workspaces/config-schema'
import { hashCanonicalJson } from '../workspaces/hash'
import { createSnapshotManifest } from '../workspaces/manifest'
import { inspectCanonicalManifest } from '../workspaces/snapshot'
import type { SnapshotEntry } from '../workspaces/schema'
import type { ChangeSet } from '../changesets/schema'
import { MergeRecordRepository } from './repository'
import { materializeMergePreview } from './preview'

const fixtureRoots: string[] = []

afterEach(async () => {
  for (const root of fixtureRoots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('threados-merge-preview-')) {
      throw new Error('Refusing to remove unexpected test fixture root')
    }
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        await rm(root, { recursive: true, force: true })
        break
      } catch (error) {
        const code = error instanceof Error && 'code' in error ? error.code : null
        if (process.platform !== 'win32' || !['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY'].includes(String(code))
          || attempt === 9) throw error
        await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 100))
      }
    }
  }
})

function entry(path: string, content: string, mode = 0o644): SnapshotEntry {
  return { path, kind: 'file', sha256: `sha256:${createHash('sha256').update(content).digest('hex')}`,
    size_bytes: Buffer.byteLength(content), mode, symlink_target: null }
}

function withRootHash(record: ChangeSet): ChangeSet {
  return { ...record, change_set_root_hash: hashCanonicalJson({
    baseline_snapshot_id: record.baseline_snapshot_id,
    baseline_manifest_hash: record.baseline_manifest_hash,
    final_workspace_manifest_hash: record.final_workspace_manifest_hash,
    entries: record.entries,
    validation_commands_required: record.validation.required_commands,
    path_scopes: record.path_scopes,
    path_scope_violations: record.path_scope_violations,
  }) }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'threados-merge-preview-'))
  fixtureRoots.push(root)
  const canonicalRoot = join(root, 'project')
  const runtimeDataRoot = join(root, 'runtime')
  const previewStorageRoot = join(root, 'previews')
  await mkdir(canonicalRoot)
  await mkdir(runtimeDataRoot)
  await writeFile(join(canonicalRoot, 'a.txt'), 'base\n')
  await writeFile(join(canonicalRoot, 'local.txt'), 'local\n')
  const config = createDefaultWorkspaceConfig()
  const inspected = await inspectCanonicalManifest({ canonicalRoot, runtimeDataRoot,
    localWorkspaceId: 'local', workflowRunId: 'run', config })
  const canonical = createSnapshotManifest('canonical', inspected.entries)
  const mode = inspected.entries.find(item => item.path === 'a.txt')?.mode ?? 0o644
  const baseline = createSnapshotManifest('baseline', [entry('a.txt', 'base\n', mode)])
  const candidate = createSnapshotManifest('candidate', [entry('a.txt', 'candidate\n', mode)])
  const selected = withRootHash({
    schema_version: 2, revision: 1, id: 'change-1', workflow_run_id: 'run', attempt_id: 'attempt',
    step_id: 'step', surface_id: 'surface', agent_ref: null, workspace_id: 'workspace',
    baseline_snapshot_id: baseline.snapshot_id, baseline_manifest_hash: baseline.root_manifest_hash,
    final_workspace_manifest_ref: 'manifest.json', final_workspace_manifest_hash: candidate.root_manifest_hash,
    change_set_root_hash: `sha256:${'0'.repeat(64)}`,
    created_at: new Date().toISOString(), entries: [], total_bytes: 0, total_lines_added: 0,
    total_lines_deleted: 0, path_scopes: null, path_scope_violations: [],
    validation: { status: 'passed', evidence_refs: [], required_commands: 0 }, output_contract_state: 'passed',
    approval_state: 'not_required', status: 'selected',
    decision: { action: 'select', actor: 'operator', idempotency_key: 'select-1', expected_revision: 0,
      decided_at: new Date().toISOString(), reason: null },
  })
  const records = new MergeRecordRepository(runtimeDataRoot)
  const plan = await records.createPlan({ schema_version: 1, id: 'plan-1', revision: 0,
    workflow_run_id: 'run', baseline_snapshot_id: 'baseline', change_set_ids: ['change-1'],
    canonical_precondition_hash: canonical.root_manifest_hash, preview_workspace_id: null,
    conflicts: [], status: 'draft', created_at: new Date().toISOString(), validated_at: null }, {
    candidate_manifest_hash: candidate.root_manifest_hash,
    selected_change_sets: [{ id: selected.id, change_set_root_hash: selected.change_set_root_hash }],
  })
  return { root, canonicalRoot, runtimeDataRoot, previewStorageRoot, config, baseline, canonical,
    candidate, selected, records, plan, loadSelectedChangeSet: async (id: string) => id === selected.id ? selected : null }
}

async function rebindInput(f: Awaited<ReturnType<typeof fixture>>,
  candidate: ReturnType<typeof createSnapshotManifest>, baseline: ReturnType<typeof createSnapshotManifest>, id: string) {
  const selected = withRootHash({ ...f.selected, baseline_manifest_hash: baseline.root_manifest_hash,
    final_workspace_manifest_hash: candidate.root_manifest_hash })
  const plan = await f.records.createPlan({ ...f.plan, id }, {
    candidate_manifest_hash: candidate.root_manifest_hash,
    selected_change_sets: [{ id: selected.id, change_set_root_hash: selected.change_set_root_hash }],
  })
  return { ...f, plan, selected, loadSelectedChangeSet: async (changeSetId: string) => changeSetId === selected.id ? selected : null }
}

describe('isolated merge preview', () => {
  test('materializes from W with candidate bytes and persists ready evidence', async () => {
    const f = await fixture()
    const result = await materializeMergePreview({ ...f, previewId: 'preview-1',
      mergeInput: { baseline: f.baseline, canonical: f.canonical, candidate: f.candidate,
        changeSetIds: ['change-1'] },
      readCandidateFile: async () => Buffer.from('candidate\n') })
    expect(await readFile(join(result.rootPath, 'a.txt'), 'utf8')).toBe('candidate\n')
    expect(await readFile(join(result.rootPath, 'local.txt'), 'utf8')).toBe('local\n')
    expect(await readFile(join(f.canonicalRoot, 'a.txt'), 'utf8')).toBe('base\n')
    expect((await f.records.getPlan('plan-1'))?.status).toBe('ready')
    expect((await f.records.getPreview('preview-1'))?.status).toBe('ready')
    expect((await f.records.getPreview('preview-1'))?.manifest_hash).toBe(result.manifest.root_manifest_hash)
    expect((await lstat(result.rootPath)).isDirectory()).toBe(true)
  })

  test('rejects stale W before staging and keeps canonical unchanged', async () => {
    const f = await fixture()
    await writeFile(join(f.canonicalRoot, 'a.txt'), 'new user edit\n')
    await expect(materializeMergePreview({ ...f, previewId: 'preview-stale',
      mergeInput: { baseline: f.baseline, canonical: f.canonical, candidate: f.candidate,
        changeSetIds: ['change-1'] }, readCandidateFile: async () => Buffer.from('candidate\n') }))
      .rejects.toThrow('MERGE_STALE_CANONICAL')
    expect(await readFile(join(f.canonicalRoot, 'a.txt'), 'utf8')).toBe('new user edit\n')
    expect(await f.records.getPreview('preview-stale')).toBeNull()
  })

  test('rejects candidate bytes that differ from C and leaves no published tree', async () => {
    const f = await fixture()
    await expect(materializeMergePreview({ ...f, previewId: 'preview-bad',
      mergeInput: { baseline: f.baseline, canonical: f.canonical, candidate: f.candidate,
        changeSetIds: ['change-1'] }, readCandidateFile: async () => Buffer.from('wrong') }))
      .rejects.toThrow('MERGE_CANDIDATE_HASH_MISMATCH')
    expect((await f.records.getPreview('preview-bad'))?.status).toBe('failed')
  })

  test('does not publish a ready plan when validation evidence persistence fails', async () => {
    const f = await fixture()
    await expect(materializeMergePreview({ ...f, previewId: 'preview-no-evidence',
      mergeInput: { baseline: f.baseline, canonical: f.canonical, candidate: f.candidate,
        changeSetIds: ['change-1'] }, readCandidateFile: async () => Buffer.from('candidate\n'),
      persistValidationEvidence: async () => { throw new Error('MERGE_EVIDENCE_WRITE_FAILED') },
    })).rejects.toThrow('MERGE_EVIDENCE_WRITE_FAILED')
    expect((await f.records.getPreview('preview-no-evidence'))?.status).toBe('failed')
    expect((await f.records.getPlan(f.plan.id))?.status).toBe('failed')
    expect(await readdir(f.previewStorageRoot)).not.toContain('preview-no-evidence')
  })

  test('a losing concurrent preview never clears the winning ready plan', async () => {
    const f = await fixture()
    let arrived = 0
    let release!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve })
    const request = (previewId: string) => materializeMergePreview({ ...f, previewId,
      mergeInput: { baseline: f.baseline, canonical: f.canonical, candidate: f.candidate,
        changeSetIds: ['change-1'] }, readCandidateFile: async () => Buffer.from('candidate\n'),
      afterEntryCopied: async () => {
        arrived += 1
        if (arrived === 2) release()
        await barrier
      },
    })
    const settled = await Promise.allSettled([request('preview-race-a'), request('preview-race-b')])
    expect(settled.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    expect(settled.filter(item => item.status === 'rejected')).toHaveLength(1)
    const winner = settled.find(item => item.status === 'fulfilled')
    if (!winner || winner.status !== 'fulfilled') throw new Error('Missing winning preview')
    const plan = await f.records.getPlan(f.plan.id)
    expect(plan?.status).toBe('ready')
    expect(plan?.preview_workspace_id).toBe(winner.value.id)
    expect((await f.records.getPreview(winner.value.id))?.status).toBe('ready')
    expect(await readFile(join(winner.value.rootPath, 'a.txt'), 'utf8')).toBe('candidate\n')
  }, 30_000)

  test('rejects a different candidate manifest under the same saved plan and Change Set ID', async () => {
    const f = await fixture()
    const replacement = createSnapshotManifest('candidate-2', [entry('a.txt', 'different\n', f.baseline.entries[0]!.mode ?? 0o644)])
    await expect(materializeMergePreview({ ...f, previewId: 'preview-c2',
      mergeInput: { baseline: f.baseline, canonical: f.canonical, candidate: replacement,
        changeSetIds: ['change-1'] }, readCandidateFile: async () => Buffer.from('different\n') }))
      .rejects.toThrow('MERGE_PLAN_PRECONDITION_FAILED')
    expect(await f.records.getPreview('preview-c2')).toBeNull()
  })

  test('refuses to create a plan for two selected Change Sets without composition proof', async () => {
    const f = await fixture()
    await expect(f.records.createPlan({ ...f.plan, id: 'plan-multi-create',
      change_set_ids: ['change-1', 'change-2'] }, {
      candidate_manifest_hash: f.candidate.root_manifest_hash,
      selected_change_sets: [
        { id: 'change-1', change_set_root_hash: f.selected.change_set_root_hash },
        { id: 'change-2', change_set_root_hash: `sha256:${'2'.repeat(64)}` },
      ],
    })).rejects.toThrow('MERGE_COMPOSITION_UNAVAILABLE')
    expect(await f.records.getPlan('plan-multi-create')).toBeNull()
  })

  test('refuses a persisted multi-selection plan before materializing any preview', async () => {
    const f = await fixture()
    const plan = { ...f.plan, id: 'plan-multi-legacy', change_set_ids: ['change-1', 'change-2'] }
    await writeFile(join(f.runtimeDataRoot, 'merge-plans', `${plan.id}.json`), JSON.stringify({
      schema_version: 1, plan,
      binding: { candidate_manifest_hash: f.candidate.root_manifest_hash, selected_change_sets: [
        { id: 'change-1', change_set_root_hash: f.selected.change_set_root_hash },
        { id: 'change-2', change_set_root_hash: `sha256:${'2'.repeat(64)}` },
      ] },
    }))
    await expect(materializeMergePreview({ ...f, plan, previewId: 'preview-multi-legacy',
      mergeInput: { baseline: f.baseline, canonical: f.canonical, candidate: f.candidate,
        changeSetIds: ['change-1', 'change-2'] }, readCandidateFile: async () => Buffer.from('candidate\n') }))
      .rejects.toThrow('MERGE_COMPOSITION_UNAVAILABLE')
    expect(await f.records.getPreview('preview-multi-legacy')).toBeNull()
  })

  test('rejects a selected Change Set whose persisted root hash changed', async () => {
    const f = await fixture()
    const mutated = { ...f.selected, change_set_root_hash: `sha256:${'0'.repeat(64)}` }
    await expect(materializeMergePreview({ ...f, previewId: 'preview-selection-drift',
      loadSelectedChangeSet: async () => mutated,
      mergeInput: { baseline: f.baseline, canonical: f.canonical, candidate: f.candidate,
        changeSetIds: ['change-1'] }, readCandidateFile: async () => Buffer.from('candidate\n') }))
      .rejects.toThrow('MERGE_SELECTION_STALE')
    expect(await f.records.getPreview('preview-selection-drift')).toBeNull()
  })

  test('rechecks selected Change Set binding before marking the preview ready', async () => {
    const f = await fixture()
    const revoked: ChangeSet = { ...f.selected, status: 'rejected',
      decision: { ...f.selected.decision!, action: 'reject', reason: 'revoked' } }
    let reads = 0
    await expect(materializeMergePreview({ ...f, previewId: 'preview-late-selection-drift',
      loadSelectedChangeSet: async () => {
        reads += 1
        return reads === 1 ? f.selected : revoked
      },
      mergeInput: { baseline: f.baseline, canonical: f.canonical, candidate: f.candidate,
        changeSetIds: ['change-1'] }, readCandidateFile: async () => Buffer.from('candidate\n') }))
      .rejects.toThrow('MERGE_SELECTION_STALE')
    expect(reads).toBe(2)
    expect((await f.records.getPlan('plan-1'))?.status).not.toBe('ready')
    expect((await f.records.getPreview('preview-late-selection-drift'))?.status).toBe('failed')
  })

  test('refuses a preview storage directory inside the canonical project', async () => {
    const f = await fixture()
    await expect(materializeMergePreview({ ...f, previewId: 'preview-overlap',
      previewStorageRoot: join(f.canonicalRoot, 'preview'),
      mergeInput: { baseline: f.baseline, canonical: f.canonical, candidate: f.candidate,
        changeSetIds: ['change-1'] }, readCandidateFile: async () => Buffer.from('candidate\n') }))
      .rejects.toThrow('MERGE_UNSAFE_PREVIEW_STORAGE')
    expect(await f.records.getPreview('preview-overlap')).toBeNull()
  })

  test('detects an edit to W during materialization before publishing', async () => {
    const f = await fixture()
    let changed = false
    await expect(materializeMergePreview({ ...f, previewId: 'preview-race',
      mergeInput: { baseline: f.baseline, canonical: f.canonical, candidate: f.candidate,
        changeSetIds: ['change-1'] }, readCandidateFile: async () => Buffer.from('candidate\n'),
      afterEntryCopied: async () => {
        if (!changed) { changed = true; await writeFile(join(f.canonicalRoot, 'local.txt'), 'user edit\n') }
      } })).rejects.toThrow('MERGE_STALE_CANONICAL')
    expect((await f.records.getPreview('preview-race'))?.status).toBe('failed')
    expect(await readFile(join(f.canonicalRoot, 'local.txt'), 'utf8')).toBe('user edit\n')
  })

  test('rejects a same-byte hardlink substituted into the staged preview', async () => {
    const f = await fixture()
    await expect(materializeMergePreview({ ...f, previewId: 'preview-hardlink',
      mergeInput: { baseline: f.baseline, canonical: f.canonical, candidate: f.candidate,
        changeSetIds: ['change-1'] }, readCandidateFile: async () => Buffer.from('candidate\n'),
      afterEntryCopied: async copied => {
        if (copied.path !== 'local.txt') return
        const stage = (await readdir(f.previewStorageRoot)).find(name => name.startsWith('staging-'))
        if (!stage) throw new Error('missing staging tree')
        const target = join(f.previewStorageRoot, stage, 'tree', 'local.txt')
        await rm(target)
        await link(join(f.canonicalRoot, 'local.txt'), target)
      } })).rejects.toThrow('MERGE_HARDLINK_DETECTED')
    expect((await f.records.getPreview('preview-hardlink'))?.status).toBe('failed')
    expect((await f.records.getPlan('plan-1'))?.status).not.toBe('ready')
    expect(await readFile(join(f.canonicalRoot, 'local.txt'), 'utf8')).toBe('local\n')
  })

  test('keeps plan non-ready and persists failure when ready-record publication and cleanup both fail', async () => {
    const f = await fixture()
    const originalUpdate = f.records.updatePreview.bind(f.records)
    f.records.updatePreview = async (id, revision, mutate) => {
      const current = await f.records.getPreview(id)
      if (current && mutate(current).status === 'ready') throw new Error('injected ready record failure')
      return originalUpdate(id, revision, mutate)
    }
    await expect(materializeMergePreview({ ...f, previewId: 'preview-recovery',
      mergeInput: { baseline: f.baseline, canonical: f.canonical, candidate: f.candidate,
        changeSetIds: ['change-1'] }, readCandidateFile: async () => Buffer.from('candidate\n'),
      removePartialDirectory: async () => { throw new Error('injected cleanup failure') } }))
      .rejects.toThrow('MERGE_PREVIEW_RECOVERY_REQUIRED')
    expect((await f.records.getPlan('plan-1'))?.status).not.toBe('ready')
    expect((await f.records.getPreview('preview-recovery'))?.status).toBe('failed')
  })

  test('materializes candidate deletion while preserving an unrelated W file', async () => {
    const f = await fixture()
    const candidate = createSnapshotManifest('candidate', [])
    const rebound = await rebindInput(f, candidate, f.baseline, 'plan-delete')
    const result = await materializeMergePreview({ ...rebound, previewId: 'preview-delete',
      mergeInput: { baseline: f.baseline, canonical: f.canonical, candidate,
        changeSetIds: ['change-1'] }, readCandidateFile: async () => { throw new Error('unexpected read') } })
    expect(result.manifest.entries.map(item => item.path)).toEqual(['local.txt'])
    expect(await readFile(join(result.rootPath, 'local.txt'), 'utf8')).toBe('local\n')
    expect(await readFile(join(f.canonicalRoot, 'a.txt'), 'utf8')).toBe('base\n')
  })

  test('materializes nested candidate additions with plain parent directories', async () => {
    const f = await fixture()
    const mode = f.baseline.entries[0]!.mode ?? 0o644
    const candidate = createSnapshotManifest('candidate', [entry('a.txt', 'base\n', mode),
      { path: 'src', kind: 'directory', sha256: null, size_bytes: 0, mode: 0o755, symlink_target: null },
      entry('src/new.txt', 'new\n', mode)])
    const rebound = await rebindInput(f, candidate, f.baseline, 'plan-nested')
    const result = await materializeMergePreview({ ...rebound, previewId: 'preview-nested',
      mergeInput: { baseline: f.baseline, canonical: f.canonical, candidate,
        changeSetIds: ['change-1'] }, readCandidateFile: async () => Buffer.from('new\n') })
    expect(await readFile(join(result.rootPath, 'src', 'new.txt'), 'utf8')).toBe('new\n')
    expect(await readFile(join(result.rootPath, 'local.txt'), 'utf8')).toBe('local\n')
  })

  test('refuses unresolved conflicts without creating a preview', async () => {
    const f = await fixture()
    const conflicting = createSnapshotManifest('candidate', [entry('a.txt', 'candidate\n')])
    const differentBaseline = createSnapshotManifest('baseline', [entry('a.txt', 'older\n')])
    const rebound = await rebindInput(f, conflicting, differentBaseline, 'plan-conflict')
    await expect(materializeMergePreview({ ...rebound, previewId: 'preview-conflict',
      mergeInput: { baseline: differentBaseline, canonical: f.canonical, candidate: conflicting,
        changeSetIds: ['change-1'] }, readCandidateFile: async () => Buffer.from('candidate\n') }))
      .rejects.toThrow('MERGE_CONFLICTS_UNRESOLVED')
    expect(await f.records.getPreview('preview-conflict')).toBeNull()
    expect((await f.records.getPlan('plan-conflict'))?.status).toBe('conflicted')
  })
})

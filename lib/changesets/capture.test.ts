import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, lstat, mkdir, readFile, rename, symlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { captureChangeSet, type CaptureChangeSetInput } from './capture'
import { ChangeSetRepository } from './repository'
import { ChangeSetContentStore } from './content-store'
import { createSnapshotManifest } from '../workspaces/manifest'
import { hashSha256Bytes } from '../workspaces/hash'
import type { SnapshotEntry, WorkspaceSnapshot, SurfaceWorkspace } from '../workspaces/schema'
import { buildExclusionPolicy } from '../workspaces/exclusions'
import { createDefaultWorkspaceConfig } from '../workspaces/config-schema'
import { buildChangeSetReview, compareChangeSets } from './diff'
import { createFixtureRoot, removeFixtureTree } from '../../test/helpers/remove-fixture-tree'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(removeFixtureTree)) })

async function fixture(): Promise<CaptureChangeSetInput> {
  const root = await createFixtureRoot('threados-change-set-')
  roots.push(root)
  const canonicalRoot = join(root, 'canonical')
  const runtimeDataRoot = join(root, 'runtime')
  const baselineRoot = join(root, 'snapshot')
  const workspaceRoot = join(root, 'workspace')
  await Promise.all([mkdir(canonicalRoot), mkdir(runtimeDataRoot), mkdir(baselineRoot), mkdir(workspaceRoot)])
  const original = Buffer.from('before\n')
  const gone = Buffer.from([0, 1, 2])
  await writeFile(join(baselineRoot, 'a.txt'), original)
  await writeFile(join(baselineRoot, 'gone.bin'), gone)
  await writeFile(join(workspaceRoot, 'a.txt'), 'after\n')
  await writeFile(join(workspaceRoot, 'new.bin'), Buffer.from([0, 255, 9]))
  const entries: SnapshotEntry[] = [
    { path: 'a.txt', kind: 'file', sha256: hashSha256Bytes(original), size_bytes: original.length, mode: 0o444, symlink_target: null },
    { path: 'gone.bin', kind: 'file', sha256: hashSha256Bytes(gone), size_bytes: gone.length, mode: 0o444, symlink_target: null },
  ]
  await chmod(join(baselineRoot, 'a.txt'), 0o444)
  await chmod(join(baselineRoot, 'gone.bin'), 0o444)
  await chmod(baselineRoot, 0o555)
  const baselineManifest = createSnapshotManifest('snapshot-1', entries)
  const exclusionPolicy = await buildExclusionPolicy({
    canonicalRoot, config: createDefaultWorkspaceConfig(), alwaysExcludedRoots: [runtimeDataRoot],
  })
  const snapshot = {
    id: 'snapshot-1', status: 'ready', content_root: baselineRoot,
    root_manifest_hash: baselineManifest.root_manifest_hash,
    exclusion_policy_hash: exclusionPolicy.exclusionPolicyHash,
  } as WorkspaceSnapshot
  const workspace = {
    id: 'workspace-1', status: 'active', root_path: workspaceRoot,
    workflow_run_id: 'run-1', attempt_id: 'attempt-1', surface_id: 'surface-1',
    snapshot_id: 'snapshot-1', manifest_hash: baselineManifest.root_manifest_hash,
  } as SurfaceWorkspace
  return {
    canonicalRoot, runtimeDataRoot, namespace: 'local-1', workflowRunId: 'run-1', attemptId: 'attempt-1',
    stepId: 'step-1', surfaceId: 'surface-1', agentRef: null, workspace, snapshot, baselineManifest,
    exclusionPolicy,
    maxFiles: 20, maxBytes: 1024, outputContractConfigured: false,
    createdAt: '2026-09-29T00:00:00.000Z',
  }
}

function repository(input: CaptureChangeSetInput): ChangeSetRepository {
  return new ChangeSetRepository({
    canonicalRoot: input.canonicalRoot, runtimeDataRoot: input.runtimeDataRoot,
    namespace: input.namespace, runId: input.workflowRunId, attemptId: input.attemptId,
  })
}

describe('Change Set capture', () => {
  test('persists add, modify and delete with binary bytes outside the canonical project', async () => {
    const input = await fixture()
    const captured = await captureChangeSet(input)
    expect(captured.entries.map(entry => [entry.path, entry.operation])).toEqual([
      ['a.txt', 'modify'], ['gone.bin', 'delete'], ['new.bin', 'add'],
    ])
    expect(captured.entries.find(entry => entry.path === 'new.bin')?.content_kind).toBe('binary')
    expect(captured.entries.find(entry => entry.path === 'gone.bin')?.content_kind).toBe('binary')
    expect(captured.entries.find(entry => entry.path === 'a.txt')?.content_kind).toBe('text')
    const saved = repository(input)
    expect((await saved.get(captured.id))?.change_set_root_hash).toBe(captured.change_set_root_hash)
    expect((await saved.getManifest(captured.id))?.root_manifest_hash).toBe(captured.final_workspace_manifest_hash)
    const store = new ChangeSetContentStore(input.runtimeDataRoot, input.namespace, input.workflowRunId, input.attemptId)
    for (const entry of captured.entries.filter(entry => entry.content_ref)) {
      expect(await store.verify(entry.content_ref!, entry.after_sha256!)).toBe(true)
    }
    const repeat = await captureChangeSet(input)
    expect(repeat.change_set_root_hash).toBe(captured.change_set_root_hash)
    await writeFile(join(input.workspace.root_path, 'a.txt'), 'changed again\n')
    await expect(captureChangeSet(input)).rejects.toThrow('workspace changed after capture')
    expect(await readFile(join(input.workspace.root_path, 'a.txt'), 'utf8')).toBe('changed again\n')
  }, 30_000)

  test('captures an internal symlink without following its target', async () => {
    const input = await fixture()
    await symlink('a.txt', join(input.workspace.root_path, 'link.txt'), 'file')
    const captured = await captureChangeSet(input)
    expect(captured.entries.find(entry => entry.path === 'link.txt')).toMatchObject({
      operation: 'symlink', after_kind: 'symlink', symlink_target_after: 'a.txt', content_ref: null,
    })
  })

  test('review returns bounded text diff, binary metadata, and no private roots', async () => {
    const input = await fixture()
    const record = await captureChangeSet(input)
    const review = await buildChangeSetReview({
      record, baselineManifest: input.baselineManifest,
      baselineContentRoot: input.snapshot.content_root!,
      contentStore: new ChangeSetContentStore(input.runtimeDataRoot, input.namespace,
        input.workflowRunId, input.attemptId),
    })
    expect(review.entries.find(entry => entry.path === 'a.txt')).toMatchObject({
      before_text: 'before\n', after_text: 'after\n',
    })
    expect(review.entries.find(entry => entry.path === 'a.txt')?.unified_diff).toContain('@@ -1,1 +1,1 @@')
    expect(review.entries.find(entry => entry.path === 'new.bin')).toMatchObject({
      content_kind: 'binary', before_text: null, after_text: null, unified_diff: null,
    })
    expect(JSON.stringify(review)).not.toContain(input.runtimeDataRoot)
    expect(JSON.stringify(review)).not.toContain(input.snapshot.content_root!)
    const privateEvidence = await buildChangeSetReview({
      record: { ...record, validation: { status: 'passed', evidence_refs: [input.runtimeDataRoot], required_commands: 0 } },
      baselineManifest: input.baselineManifest, baselineContentRoot: input.snapshot.content_root!,
      contentStore: new ChangeSetContentStore(input.runtimeDataRoot, input.namespace,
        input.workflowRunId, input.attemptId),
    })
    expect(privateEvidence.test_evidence_refs).toEqual(['[redacted]'])
    expect(JSON.stringify(privateEvidence)).not.toContain(input.runtimeDataRoot)
    const comparison = compareChangeSets(record, {
      ...record, id: 'other', attempt_id: 'attempt-2',
      entries: record.entries.map(entry => entry.path === 'a.txt'
        ? { ...entry, after_sha256: `sha256:${'b'.repeat(64)}` }
        : entry),
    })
    expect(comparison.paths.find(item => item.path === 'a.txt')?.relation).toBe('different')
    expect(comparison.paths.find(item => item.path === 'new.bin')?.relation).toBe('identical')
  }, 30_000)

  test('binary baseline changed to UTF-8 remains a binary review transition', async () => {
    const input = await fixture()
    await writeFile(join(input.workspace.root_path, 'gone.bin'), 'now readable text\n')
    const captured = await captureChangeSet(input)
    expect(captured.entries.find(entry => entry.path === 'gone.bin')?.content_kind).toBe('binary')
    const review = await buildChangeSetReview({
      record: captured, baselineManifest: input.baselineManifest,
      baselineContentRoot: input.snapshot.content_root!,
      contentStore: new ChangeSetContentStore(input.runtimeDataRoot, input.namespace,
        input.workflowRunId, input.attemptId),
    })
    expect(review.entries.find(entry => entry.path === 'gone.bin')).toMatchObject({
      content_kind: 'binary', before_text: null, after_text: null, unified_diff: null,
    })
  })

  if (process.platform !== 'win32') test('distinguishes a mode-only change from a byte change', async () => {
    const input = await fixture()
    await writeFile(join(input.workspace.root_path, 'a.txt'), 'before\n')
    await chmod(join(input.workspace.root_path, 'a.txt'), 0o755)
    const captured = await captureChangeSet(input)
    expect(captured.entries.find(entry => entry.path === 'a.txt')?.operation).toBe('chmod')
  })

  test('records out-of-scope paths deterministically', async () => {
    const input = await fixture()
    const captured = await captureChangeSet({ ...input, pathScopes: ['a.txt'] })
    expect(captured.path_scope_violations).toEqual(['gone.bin', 'new.bin'])
    expect(captured.validation.status).toBe('failed')
    const noPaths = await fixture()
    expect((await captureChangeSet({ ...noPaths, pathScopes: [] })).path_scope_violations)
      .toEqual(['a.txt', 'gone.bin', 'new.bin'])
    const glob = await fixture()
    await mkdir(join(glob.workspace.root_path, 'docs'))
    await writeFile(join(glob.workspace.root_path, 'docs', 'note.txt'), 'note')
    expect((await captureChangeSet({ ...glob, pathScopes: ['docs/**'] })).path_scope_violations)
      .not.toContain('docs/note.txt')
    const exact = await fixture()
    await mkdir(join(exact.workspace.root_path, 'docs'))
    await writeFile(join(exact.workspace.root_path, 'docs', 'note.txt'), 'note')
    expect((await captureChangeSet({ ...exact, pathScopes: ['docs'] })).path_scope_violations)
      .toContain('docs/note.txt')
  }, 30_000)

  test('excludes bootstrap-created dependency and build trees using the baseline policy', async () => {
    const input = await fixture()
    for (const directory of ['node_modules', '.next', 'dist', '.git', '.threados']) {
      await mkdir(join(input.workspace.root_path, directory))
      await writeFile(join(input.workspace.root_path, directory, 'generated.txt'), directory)
    }
    const captured = await captureChangeSet(input)
    expect(captured.entries.map(entry => entry.path)).toEqual(['a.txt', 'gone.bin', 'new.bin'])
    expect((await repository(input).getManifest(captured.id))?.entries.map(entry => entry.path)).toEqual(['a.txt', 'new.bin'])
  })

  test('rejects changed exclusion policy and retains the workspace', async () => {
    const input = await fixture()
    const changed = await buildExclusionPolicy({
      canonicalRoot: input.canonicalRoot,
      config: { ...createDefaultWorkspaceConfig(), snapshot: {
        ...createDefaultWorkspaceConfig().snapshot, exclusions: ['other/'],
      } },
      alwaysExcludedRoots: [input.runtimeDataRoot],
    })
    await expect(captureChangeSet({ ...input, exclusionPolicy: changed })).rejects.toThrow('CHANGE_SET_BASELINE_MISMATCH')
  })

  test('sealed blob tampering fails repository retrieval', async () => {
    const input = await fixture()
    const captured = await captureChangeSet(input)
    const entry = captured.entries.find(candidate => candidate.path === 'a.txt')!
    const blob = join(input.runtimeDataRoot, 'changesets', input.namespace, input.workflowRunId,
      input.attemptId, entry.content_ref!)
    expect((await lstat(blob)).mode & 0o222).toBe(0)
    await chmod(blob, 0o666)
    await writeFile(blob, 'tampered\n')
    await expect(repository(input).get(captured.id)).rejects.toThrow('CHANGE_SET_CONTENT_CORRUPT')
  })

  test('rejects a blob store redirected outside the trusted runtime root', async () => {
    const input = await fixture()
    const captured = await captureChangeSet(input)
    const storeRoot = join(input.runtimeDataRoot, 'changesets', input.namespace, input.workflowRunId, input.attemptId)
    const outside = join(input.runtimeDataRoot, '..', 'escaped-content')
    await rename(storeRoot, outside)
    await symlink(outside, storeRoot, 'dir')
    await expect(repository(input).get(captured.id)).rejects.toThrow()
  })

  test('refuses promotion and sealing through a redirected runtime parent', async () => {
    const input = await fixture()
    const store = new ChangeSetContentStore(input.runtimeDataRoot, input.namespace, input.workflowRunId, input.attemptId)
    const stage = await store.stage()
    const source = join(input.workspace.root_path, 'a.txt')
    const bytes = await readFile(source)
    await stage.copy(source, hashSha256Bytes(bytes), bytes.length)
    const runRoot = join(input.runtimeDataRoot, 'changesets', input.namespace, input.workflowRunId)
    const outside = join(input.runtimeDataRoot, '..', 'escaped-run')
    await rename(runRoot, outside)
    await symlink(outside, runRoot, 'dir')
    await expect(stage.commit()).rejects.toThrow()
    expect(await lstat(join(outside, 'attempt-1')).catch(() => null)).toBeNull()
  })

  test('same attempt ID with changed lineage cannot reuse a record', async () => {
    const input = await fixture()
    const captured = await captureChangeSet(input)
    await expect(captureChangeSet({ ...input, stepId: 'different-step' })).rejects.toThrow('CHANGE_SET_IDENTITY_MISMATCH')
    await expect(captureChangeSet({ ...input, agentRef: 'different-agent' })).rejects.toThrow('CHANGE_SET_IDENTITY_MISMATCH')
    await expect(captureChangeSet({ ...input, workspace: { ...input.workspace, id: 'different-workspace' } })).rejects.toThrow('CHANGE_SET_IDENTITY_MISMATCH')
    await expect(repository(input).create({ ...captured, step_id: 'different-step' },
      (await repository(input).getManifest(captured.id))!)).rejects.toThrow('CHANGE_SET_CONFLICT')
  })

  test('rejects an escaping symlink and leaves no captured record', async () => {
    const input = await fixture()
    await symlink(input.canonicalRoot, join(input.workspace.root_path, 'escape'), 'dir')
    await expect(captureChangeSet(input)).rejects.toThrow()
    expect(await repository(input).get('change-set-attempt-1')).toBeNull()
  })
})

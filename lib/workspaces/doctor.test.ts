import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, rm, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { createDefaultWorkspaceConfig } from './config-schema'
import { doctorWorkspaces } from './doctor'
import { createSnapshotManifest } from './manifest'
import { SurfaceWorkspaceManager } from './manager'
import { resolveWorkspaceRuntimePaths } from './paths'
import { SnapshotRepository } from './snapshot-repository'
import type { WorkspaceSnapshot } from './schema'
import { createFixtureRoot, removeFixtureTree } from '../../test/helpers/remove-fixture-tree'

const roots: string[] = []
const timestamp = '2026-08-28T00:00:00.000Z'

async function tempRoot(prefix: string): Promise<string> {
  const root = await createFixtureRoot(prefix)
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(removeFixtureTree))
})

describe('workspace doctor', () => {
  test('detects missing trees, invalid manifests, and orphaned workspace directories', async () => {
    const canonicalRoot = await tempRoot('threados-doctor-canonical-')
    const runtimeDataRoot = await tempRoot('threados-doctor-runtime-')
    const manifest = createSnapshotManifest('snapshot-01', [{
      path: 'file.txt', kind: 'file',
      sha256: `sha256:${new Bun.CryptoHasher('sha256').update('baseline\n').digest('hex')}`,
      size_bytes: Buffer.byteLength('baseline\n'), mode: 0o644, symlink_target: null,
    }])
    const tree = join(
      resolveWorkspaceRuntimePaths(runtimeDataRoot, 'local-01', canonicalRoot).snapshotsRoot,
      manifest.root_manifest_hash.slice('sha256:'.length),
      'tree',
    )
    await mkdir(tree, { recursive: true })
    await writeFile(join(tree, 'file.txt'), 'baseline\n')
    await chmod(join(tree, 'file.txt'), 0o444)
    await chmod(tree, 0o555)
    const snapshot: WorkspaceSnapshot = {
      schema_version: 1, id: 'snapshot-01', local_workspace_id: 'local-01', workflow_run_id: 'run-01',
      source_root: canonicalRoot, content_root: tree,
      manifest_ref: '.threados/snapshots/snapshot-01/manifest.json', status: 'ready',
      root_manifest_hash: manifest.root_manifest_hash, exclusion_policy_hash: `sha256:${'e'.repeat(64)}`,
      file_count: 1, total_bytes: Buffer.byteLength('baseline\n'), git_head: null, git_dirty: null,
      created_at: timestamp, verified_at: timestamp, error_code: null, directory_count: 0, symlink_count: 0,
      blocked_symlink_paths: [], source_retry_count: 0,
    }
    const snapshots = new SnapshotRepository(canonicalRoot)
    await snapshots.create(snapshot, manifest)
    const ids = ['missing', 'invalid', 'outside', 'cleaned']
    const manager = new SurfaceWorkspaceManager({
      canonicalRoot, runtimeDataRoot, localWorkspaceId: 'local-01', createId: () => ids.shift()!,
    })
    const config = createDefaultWorkspaceConfig()
    const missing = await manager.provision({
      workflowRunId: 'run-01', attemptId: 'attempt-01', surfaceId: 'surface-01', snapshotId: 'snapshot-01', config,
    })
    const invalid = await manager.provision({
      workflowRunId: 'run-01', attemptId: 'attempt-02', surfaceId: 'surface-02', snapshotId: 'snapshot-01', config,
    })
    const outside = await manager.provision({
      workflowRunId: 'run-01', attemptId: 'attempt-03', surfaceId: 'surface-03', snapshotId: 'snapshot-01', config,
    })
    const cleaned = await manager.provision({
      workflowRunId: 'run-01', attemptId: 'attempt-04', surfaceId: 'surface-04', snapshotId: 'snapshot-01', config,
    })
    await rm(dirname(missing.root_path), { recursive: true, force: true })
    await writeFile(join(invalid.root_path, 'file.txt'), 'changed\n')
    const invalidRecordPath = join(
      canonicalRoot,
      '.threados',
      'workspaces',
      'records',
      `${invalid.id}.json`,
    )
    const invalidRecord = JSON.parse(await Bun.file(invalidRecordPath).text())
    await writeFile(invalidRecordPath, JSON.stringify({
      ...invalidRecord,
      status: 'failed',
      error_code: 'WORKSPACE_RECOVERY_REQUIRED',
    }))

    const forgedTree = join(runtimeDataRoot, 'forged-outside-tree')
    await mkdir(forgedTree)
    await writeFile(join(forgedTree, 'file.txt'), 'baseline\n')
    const outsideRecordPath = join(
      canonicalRoot,
      '.threados',
      'workspaces',
      'records',
      `${outside.id}.json`,
    )
    const outsideRecord = JSON.parse(await Bun.file(outsideRecordPath).text())
    await writeFile(outsideRecordPath, JSON.stringify({ ...outsideRecord, root_path: forgedTree }))

    await manager.finalize(cleaned.id, { outcome: 'applied' })
    await mkdir(dirname(cleaned.root_path), { recursive: true })

    const workspacesRoot = resolveWorkspaceRuntimePaths(runtimeDataRoot, 'local-01', canonicalRoot).workspacesRoot
    await mkdir(join(workspacesRoot, 'run-orphan', 'workspace-orphan', 'tree'), { recursive: true })
    const report = await doctorWorkspaces({
      repository: manager,
      snapshotRepository: snapshots,
      workspacesRoot,
    })

    expect(report.healthy).toBe(false)
    expect(report.issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'WORKSPACE_TREE_MISSING',
      'WORKSPACE_MANIFEST_INVALID',
      'WORKSPACE_ORPHANED_DIRECTORY',
      'WORKSPACE_STORAGE_UNSAFE',
      'WORKSPACE_RECOVERY_REQUIRED',
    ]))
    expect(report.checkedRecords).toBe(4)
  })
})

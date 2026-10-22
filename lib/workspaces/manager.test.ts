import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { createDefaultWorkspaceConfig } from './config-schema'
import { createSnapshotManifest } from './manifest'
import { SurfaceWorkspaceManager, SurfaceWorkspaceTraceError } from './manager'
import { SnapshotRepository } from './snapshot-repository'
import { WorkspaceRepository } from './repository'
import type { WorkspaceSnapshot } from './schema'
import { readTraceEvents } from '@/lib/traces/reader'
import { resolveWorkspaceRuntimePaths } from './paths'
import { createFixtureRoot, removeFixtureTree } from '../../test/helpers/remove-fixture-tree'

const roots: string[] = []
const timestamp = '2026-08-28T00:00:00.000Z'

async function tempRoot(prefix: string): Promise<string> {
  const root = await createFixtureRoot(prefix)
  roots.push(root)
  return root
}

async function fixture() {
  const canonicalRoot = await tempRoot('threados-manager-canonical-')
  const runtimeDataRoot = await tempRoot('threados-manager-runtime-')
  await writeFile(join(canonicalRoot, 'canonical.txt'), 'canonical\n')
  const content = 'baseline\n'
  const manifest = createSnapshotManifest('snapshot-01', [{
    path: 'app.txt',
    kind: 'file',
    sha256: `sha256:${new Bun.CryptoHasher('sha256').update(content).digest('hex')}`,
    size_bytes: Buffer.byteLength(content),
    mode: 0o644,
    symlink_target: null,
  }])
  const tree = join(
    resolveWorkspaceRuntimePaths(runtimeDataRoot, 'local-01', canonicalRoot).snapshotsRoot,
    manifest.root_manifest_hash.slice('sha256:'.length),
    'tree',
  )
  await mkdir(tree, { recursive: true })
  await writeFile(join(tree, 'app.txt'), content)
  await chmod(join(tree, 'app.txt'), 0o444)
  await chmod(tree, 0o555)
  const snapshot: WorkspaceSnapshot = {
    schema_version: 1,
    id: 'snapshot-01',
    local_workspace_id: 'local-01',
    workflow_run_id: 'run-01',
    source_root: canonicalRoot,
    content_root: tree,
    manifest_ref: '.threados/snapshots/snapshot-01/manifest.json',
    status: 'ready',
    root_manifest_hash: manifest.root_manifest_hash,
    exclusion_policy_hash: `sha256:${'e'.repeat(64)}`,
    file_count: 1,
    total_bytes: Buffer.byteLength(content),
    git_head: null,
    git_dirty: null,
    created_at: timestamp,
    verified_at: timestamp,
    error_code: null,
    directory_count: 0,
    symlink_count: 0,
    blocked_symlink_paths: [],
    source_retry_count: 0,
  }
  await new SnapshotRepository(canonicalRoot).create(snapshot, manifest)
  return { canonicalRoot, runtimeDataRoot, tree, manifest }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(removeFixtureTree))
})

describe('SurfaceWorkspaceManager', () => {
  test('provisions two independent roots from one identical snapshot without canonical mutation', async () => {
    const context = await fixture()
    const ids = ['one', 'two']
    const manager = new SurfaceWorkspaceManager({
      canonicalRoot: context.canonicalRoot,
      runtimeDataRoot: context.runtimeDataRoot,
      localWorkspaceId: 'local-01',
      now: () => new Date(timestamp),
      createId: () => ids.shift()!,
    })
    const config = createDefaultWorkspaceConfig()

    const first = await manager.provision({
      workflowRunId: 'run-01',
      attemptId: 'attempt-01',
      surfaceId: 'surface-01',
      snapshotId: 'snapshot-01',
      config,
    })
    const second = await manager.provision({
      workflowRunId: 'run-01',
      attemptId: 'attempt-02',
      surfaceId: 'surface-02',
      snapshotId: 'snapshot-01',
      config,
    })

    expect(first.root_path).not.toBe(second.root_path)
    expect(first.manifest_hash).toBe(second.manifest_hash)
    await writeFile(join(first.root_path, 'app.txt'), 'candidate A\n')
    expect(await readFile(join(second.root_path, 'app.txt'), 'utf8')).toBe('baseline\n')
    expect(await readFile(join(context.tree, 'app.txt'), 'utf8')).toBe('baseline\n')
    expect(await readFile(join(context.canonicalRoot, 'canonical.txt'), 'utf8')).toBe('canonical\n')
    expect((await readTraceEvents(context.canonicalRoot, 'run-01')).map(event => event.event_type))
      .toEqual([
        'workspace-provision-started',
        'workspace-ready',
        'workspace-provision-started',
        'workspace-ready',
      ])
  })

  test('rejects quota exhaustion before creating or dispatching another workspace', async () => {
    const context = await fixture()
    const ids = ['one', 'two']
    const manager = new SurfaceWorkspaceManager({
      canonicalRoot: context.canonicalRoot,
      runtimeDataRoot: context.runtimeDataRoot,
      localWorkspaceId: 'local-01',
      createId: () => ids.shift()!,
    })
    const config = createDefaultWorkspaceConfig()
    config.workspace.max_active = 1
    await manager.provision({
      workflowRunId: 'run-01', attemptId: 'attempt-01', surfaceId: 'surface-01', snapshotId: 'snapshot-01', config,
    })

    await expect(manager.provision({
      workflowRunId: 'run-01', attemptId: 'attempt-02', surfaceId: 'surface-02', snapshotId: 'snapshot-01', config,
    })).rejects.toMatchObject({ code: 'WORKSPACE_QUOTA_EXCEEDED' })
    expect(await manager.list()).toHaveLength(1)
  })

  test('atomically reserves the final active quota slot under concurrent provisioning', async () => {
    const context = await fixture()
    const ids = ['concurrent-a', 'concurrent-b']
    const manager = new SurfaceWorkspaceManager({
      canonicalRoot: context.canonicalRoot,
      runtimeDataRoot: context.runtimeDataRoot,
      localWorkspaceId: 'local-01',
      createId: () => ids.shift()!,
    })
    const config = createDefaultWorkspaceConfig()
    config.workspace.max_active = 1

    const results = await Promise.allSettled([
      manager.provision({
        workflowRunId: 'run-01', attemptId: 'attempt-a', surfaceId: 'surface-a', snapshotId: 'snapshot-01', config,
      }),
      manager.provision({
        workflowRunId: 'run-01', attemptId: 'attempt-b', surfaceId: 'surface-b', snapshotId: 'snapshot-01', config,
      }),
    ])

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected'))
      .toMatchObject({ reason: { code: 'WORKSPACE_QUOTA_EXCEEDED' } })
    expect(await manager.list()).toHaveLength(1)
  })

  test('atomically reserves projected retained bytes under concurrent provisioning', async () => {
    const context = await fixture()
    const ids = ['bytes-a', 'bytes-b']
    const manager = new SurfaceWorkspaceManager({
      canonicalRoot: context.canonicalRoot,
      runtimeDataRoot: context.runtimeDataRoot,
      localWorkspaceId: 'local-01',
      createId: () => ids.shift()!,
    })
    const config = createDefaultWorkspaceConfig()
    config.workspace.max_active = 2
    config.workspace.max_bytes_each = 10
    config.workspace.max_total_retained_bytes = 10

    const results = await Promise.allSettled([
      manager.provision({
        workflowRunId: 'run-01', attemptId: 'attempt-a', surfaceId: 'surface-a', snapshotId: 'snapshot-01', config,
      }),
      manager.provision({
        workflowRunId: 'run-01', attemptId: 'attempt-b', surfaceId: 'surface-b', snapshotId: 'snapshot-01', config,
      }),
    ])

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected'))
      .toMatchObject({ reason: { code: 'WORKSPACE_QUOTA_EXCEEDED' } })
    expect((await manager.list())[0]?.reserved_bytes).toBe(Buffer.byteLength('baseline\n'))
  })

  test('retains successful M1 output even under cleanup_on_success', async () => {
    const context = await fixture()
    const manager = new SurfaceWorkspaceManager({
      canonicalRoot: context.canonicalRoot,
      runtimeDataRoot: context.runtimeDataRoot,
      localWorkspaceId: 'local-01',
      createId: () => 'retained',
    })
    const config = createDefaultWorkspaceConfig()
    config.workspace.retention = 'cleanup_on_success'
    const ready = await manager.provision({
      workflowRunId: 'run-01', attemptId: 'attempt-01', surfaceId: 'surface-01', snapshotId: 'snapshot-01', config,
    })

    const result = await manager.finalize(ready.id, { outcome: 'successful' })
    expect(result.decision).toEqual({ action: 'retain', reason: 'awaiting_apply' })
    expect(result.workspace.status).toBe('retained')
    expect(await readFile(join(result.workspace.root_path, 'app.txt'), 'utf8')).toBe('baseline\n')
    expect((await readTraceEvents(context.canonicalRoot, 'run-01')).at(-1)?.event_type)
      .toBe('workspace-retained')
  })

  test('reports trace projection failure without hiding a committed ready workspace', async () => {
    const context = await fixture()
    const manager = new SurfaceWorkspaceManager({
      canonicalRoot: context.canonicalRoot,
      runtimeDataRoot: context.runtimeDataRoot,
      localWorkspaceId: 'local-01',
      createId: () => 'trace-failure',
      appendTrace: async (_basePath, _runId, event) => {
        if (event.event_type === 'workspace-ready') throw new Error('injected trace failure')
      },
    })

    try {
      await manager.provision({
        workflowRunId: 'run-01',
        attemptId: 'attempt-01',
        surfaceId: 'surface-01',
        snapshotId: 'snapshot-01',
        config: createDefaultWorkspaceConfig(),
      })
      throw new Error('provision unexpectedly succeeded')
    } catch (error) {
      expect(error).toBeInstanceOf(SurfaceWorkspaceTraceError)
      expect((error as SurfaceWorkspaceTraceError).commit_status).toBe('committed')
      expect((error as SurfaceWorkspaceTraceError).eventType).toBe('workspace-ready')
      expect((error as SurfaceWorkspaceTraceError).workspace.status).toBe('ready')
    }
    expect((await manager.list())[0]?.status).toBe('ready')
  })

  test('continues provisioning after a start-trace failure so quota is not stranded planned', async () => {
    const context = await fixture()
    const manager = new SurfaceWorkspaceManager({
      canonicalRoot: context.canonicalRoot,
      runtimeDataRoot: context.runtimeDataRoot,
      localWorkspaceId: 'local-01',
      createId: () => 'start-trace-failure',
      appendTrace: async (_basePath, _runId, event) => {
        if (event.event_type === 'workspace-provision-started') throw new Error('injected start trace failure')
      },
    })

    await expect(manager.provision({
      workflowRunId: 'run-01',
      attemptId: 'attempt-01',
      surfaceId: 'surface-01',
      snapshotId: 'snapshot-01',
      config: createDefaultWorkspaceConfig(),
    })).rejects.toMatchObject({
      commit_status: 'committed',
      eventType: 'workspace-provision-started',
      workspace: { status: 'ready' },
    })
    expect((await manager.list())[0]?.status).toBe('ready')
  })

  test('persists cleaning before deletion and emits cleaned evidence', async () => {
    const context = await fixture()
    const manager = new SurfaceWorkspaceManager({
      canonicalRoot: context.canonicalRoot,
      runtimeDataRoot: context.runtimeDataRoot,
      localWorkspaceId: 'local-01',
      createId: () => 'cleaned',
    })
    const ready = await manager.provision({
      workflowRunId: 'run-01',
      attemptId: 'attempt-01',
      surfaceId: 'surface-01',
      snapshotId: 'snapshot-01',
      config: createDefaultWorkspaceConfig(),
    })

    const result = await manager.finalize(ready.id, { outcome: 'applied' })
    expect(result.workspace.status).toBe('cleaned')
    expect((await readTraceEvents(context.canonicalRoot, 'run-01')).at(-1)?.event_type)
      .toBe('workspace-cleaned')
  })

  test('freezes an active pristine workspace before cancelled cleanup', async () => {
    const context = await fixture()
    const manager = new SurfaceWorkspaceManager({
      canonicalRoot: context.canonicalRoot,
      runtimeDataRoot: context.runtimeDataRoot,
      localWorkspaceId: 'local-01',
      createId: () => 'cancelled-clean',
    })
    const ready = await manager.provision({
      workflowRunId: 'run-01',
      attemptId: 'attempt-01',
      surfaceId: 'surface-01',
      snapshotId: 'snapshot-01',
      config: createDefaultWorkspaceConfig(),
    })
    await new WorkspaceRepository(context.canonicalRoot).update(
      ready.id,
      ready.revision,
      current => ({ ...current, status: 'active' }),
    )

    const result = await manager.finalize(ready.id, {
      outcome: 'cancelled_before_write',
      hasUsefulOutput: false,
    })
    expect(result.decision).toEqual({ action: 'cleanup', reason: 'cancelled_pristine' })
    expect(result.workspace.status).toBe('cleaned')
  })

  test('fails truthfully when host isolation is requested from the copy provider', async () => {
    const context = await fixture()
    const manager = new SurfaceWorkspaceManager({
      canonicalRoot: context.canonicalRoot,
      runtimeDataRoot: context.runtimeDataRoot,
      localWorkspaceId: 'local-01',
    })
    const config = createDefaultWorkspaceConfig()
    await expect(manager.provision({
      workflowRunId: 'run-01',
      attemptId: 'attempt-01',
      surfaceId: 'surface-01',
      snapshotId: 'snapshot-01',
      requestedIsolation: 'HOST_ENFORCED',
      config,
    })).rejects.toMatchObject({ code: 'WORKSPACE_PROVIDER_UNAVAILABLE' })
    expect(await manager.list()).toHaveLength(0)
  })
})

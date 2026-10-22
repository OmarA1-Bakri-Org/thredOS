import { afterEach, expect, setDefaultTimeout, test } from 'bun:test'
import { spawn } from 'child_process'
import { mkdir, rm, writeFile, readFile } from 'fs/promises'
import { join } from 'path'
import { captureSnapshot } from '../workspaces/snapshot'
import { createDefaultWorkspaceConfig } from '../workspaces/config-schema'
import { writeWorkspaceConfig } from '../workspaces/config'
import { readLocalWorkspace } from '../local-first/workspace'
import { SurfaceWorkspaceManager } from '../workspaces/manager'
import { WorkspaceRepository } from '../workspaces/repository'
import { WorkspaceOperations } from './workspace-operations'
import { clearRuntimeServiceFactoryForTests, getThreadOSRuntimeService } from './factory'
import { AttemptRepository } from './attempt-repository'
import { ProcessRepository } from './process-repository'
import { RunRepository } from './run-repository'
import { processRecordPath } from './paths'
import type { StepAttemptStatus } from './schema'
import { createFixtureRoot, removeFixtureTree } from '../../test/helpers/remove-fixture-tree'

const roots: string[] = []
const NOW = '2026-09-06T00:00:00.000Z'

setDefaultTimeout(30_000)

afterEach(async () => {
  clearRuntimeServiceFactoryForTests()
  await Promise.all(roots.splice(0).map(removeFixtureTree))
})

async function fixture() {
  const basePath = await createFixtureRoot('threados-workspace-ops-'); roots.push(basePath)
  const runtime = await createFixtureRoot('threados-workspace-storage-'); roots.push(runtime)
  const config = { ...createDefaultWorkspaceConfig(), runtime_data_root: runtime }
  await writeWorkspaceConfig(basePath, config)
  await writeFile(join(basePath, 'source.txt'), 'original')
  const local = await readLocalWorkspace(basePath)
  const captured = await captureSnapshot({ canonicalRoot: basePath, runtimeDataRoot: runtime, localWorkspaceId: local.id, workflowRunId: 'run-test', config })
  const manager = new SurfaceWorkspaceManager({ canonicalRoot: basePath, runtimeDataRoot: runtime, localWorkspaceId: local.id })
  const workspace = await manager.provision({ workflowRunId: 'run-test', attemptId: 'attempt-test', surfaceId: 'surface-test', snapshotId: captured.snapshot.id, config })
  return { basePath, workspace, ops: new WorkspaceOperations(basePath), manager }
}

async function persistAttempt(
  basePath: string,
  workspaceId: string,
  snapshotId: string,
  status: StepAttemptStatus,
  processStatus?: 'running' | 'exited',
): Promise<void> {
  const processId = processStatus ? 'process-test' : null
  await new RunRepository(basePath).create({
    schema_version: 2,
    id: 'run-test',
    revision: 0,
    sequence_id: 'sequence-test',
    sequence_snapshot_hash: 'sequence-hash',
    target: { kind: 'step', step_id: 'step-test' },
    strategy: 'sequential',
    status: ['pending', 'provisioning', 'running'].includes(status) ? 'running' : 'successful',
    max_concurrency: 1,
    policy_snapshot_hash: 'policy-hash',
    baseline_snapshot_id: snapshotId,
    attempt_ids: ['attempt-test'],
    created_by: 'test',
    created_via: 'system',
    created_at: NOW,
    started_at: NOW,
    ended_at: ['pending', 'provisioning', 'running'].includes(status) ? null : NOW,
    cancellation_requested_at: null,
    summary: null,
    error_code: null,
    error_message: null,
  })
  await new AttemptRepository(basePath).create({
    schema_version: 2,
    id: 'attempt-test',
    revision: 0,
    workflow_run_id: 'run-test',
    sequence_id: 'sequence-test',
    step_id: 'step-test',
    surface_id: 'surface-test',
    execution_index: 1,
    attempt_number: 1,
    retry_of_attempt_id: null,
    status,
    agent_ref: null,
    model: 'codex',
    side_effect_class: 'write',
    baseline_snapshot_id: snapshotId,
    workspace_id: workspaceId,
    process_id: processId,
    compiled_prompt_hash: 'prompt-hash',
    input_manifest_ref: null,
    output_manifest_ref: null,
    artifact_manifest_ref: null,
    change_set_id: null,
    gate_decision_refs: [],
    created_at: NOW,
    started_at: NOW,
    ended_at: ['pending', 'provisioning', 'running'].includes(status) ? null : NOW,
    last_heartbeat_at: null,
    exit_code: status === 'completed' ? 0 : null,
    signal: null,
    duration_ms: ['pending', 'provisioning', 'running'].includes(status) ? null : 1,
    error_code: null,
    error_message: null,
  })
  if (processStatus) {
    await new ProcessRepository(basePath).create({
      schema_version: 1,
      id: 'process-test',
      revision: 0,
      workflow_run_id: 'run-test',
      attempt_id: 'attempt-test',
      provider: 'local-process',
      provider_handle: String(process.pid),
      pid: process.pid,
      command: 'fixture-agent',
      redacted_args: [],
      environment_keys: [],
      cwd: basePath,
      status: processStatus,
      launch_requested_at: NOW,
      started_at: NOW,
      ended_at: processStatus === 'exited' ? NOW : null,
      last_output_at: null,
      last_heartbeat_at: null,
      cancellation_requested_at: null,
      exit_code: processStatus === 'exited' ? 0 : null,
      signal: null,
    })
  }
}

const context = (key: string) => ({ actor: 'operator', interface: 'cli' as const, idempotencyKey: key, policyConfirmed: true })

async function stoppedProcessFixture(pid: number | null) {
  const current = await fixture()
  await persistAttempt(current.basePath, current.workspace.id, current.workspace.snapshot_id, 'completed', 'exited')
  const repository = new ProcessRepository(current.basePath)
  const record = await repository.get('process-test')
  if (!record) throw new Error('Fixture process record is missing')
  await repository.update(record.id, record.revision, value => ({
    ...value, pid, provider_handle: pid === null ? null : `pid:${pid}`,
    workspace_id: current.workspace.id, cwd: current.workspace.root_path,
  }))
  return { ...current, repository }
}

async function preservedFixtureSentinels(current: Awaited<ReturnType<typeof fixture>>) {
  expect(await readFile(join(current.basePath, 'source.txt'), 'utf8')).toBe('original')
  expect(await readFile(join(current.workspace.root_path, 'source.txt'), 'utf8')).toBe('original')
}

test('cleanup proof rejects lost evidence even when a PID was recorded', async () => {
  const current = await stoppedProcessFixture(2_000_000_000)
  const record = await current.repository.get('process-test')
  if (!record) throw new Error('Fixture process record is missing')
  await current.repository.update(record.id, record.revision, value => ({ ...value, status: 'lost' }))
  await expect(current.ops.mutate('clean', current.workspace.id, context('lost-with-pid')))
    .rejects.toMatchObject({ code: 'WORKSPACE_NOT_CLEANABLE' })
  await preservedFixtureSentinels(current)
})

test.each(['lost', 'exited'] as const)('cleanup proof rejects %s process evidence without a PID', async status => {
  const current = await stoppedProcessFixture(null)
  const record = await current.repository.get('process-test')
  if (!record) throw new Error('Fixture process record is missing')
  await current.repository.update(record.id, record.revision, value => ({ ...value, status }))
  const service = await getThreadOSRuntimeService(current.basePath)
  await expect(service.cleanWorkspace(current.workspace.id, context(`missing-pid-${status}`)))
    .rejects.toMatchObject({ code: 'WORKSPACE_NOT_CLEANABLE' })
  await preservedFixtureSentinels(current)
})

test.each(['missing', 'malformed', 'wrong-owner', 'duplicate', 'prior-bootstrap'] as const)(
  'cleanup proof rejects %s canonical process evidence', async corruption => {
    const current = await stoppedProcessFixture(null)
    const path = await processRecordPath(current.basePath, 'run-test', 'attempt-test', 'process-test')
    const record = await current.repository.get('process-test')
    if (corruption === 'missing') await rm(path)
    else if (corruption === 'malformed' || corruption === 'prior-bootstrap') await writeFile(path, '{invalid')
    else if (corruption === 'wrong-owner') await writeFile(path, JSON.stringify({ ...record, attempt_id: 'other-attempt' }))
    else await writeFile(join(current.basePath, '.threados/runs/run-test/attempts/attempt-test/process.json'), JSON.stringify(record))
    if (corruption === 'prior-bootstrap') {
      const attempts = new AttemptRepository(current.basePath)
      const attempt = await attempts.get('attempt-test')
      if (!attempt) throw new Error('Fixture attempt is missing')
      await attempts.update(attempt.id, attempt.revision, value => ({ ...value, process_id: null }))
    }
    await expect(current.ops.mutate('clean', current.workspace.id, context(corruption)))
      .rejects.toMatchObject({ code: 'WORKSPACE_NOT_CLEANABLE' })
    await preservedFixtureSentinels(current)
  },
)

test('cleanup proof rejects missing attempt and process records still named by the canonical run', async () => {
  const current = await stoppedProcessFixture(null)
  const attemptRoot = join(current.basePath, '.threados/runs/run-test/attempts/attempt-test')
  await rm(join(attemptRoot, 'attempt.json'))
  await rm(await processRecordPath(current.basePath, 'run-test', 'attempt-test', 'process-test'))
  await expect(current.ops.mutate('clean', current.workspace.id, context('missing-attempt')))
    .rejects.toMatchObject({ code: 'WORKSPACE_NOT_CLEANABLE' })
  await preservedFixtureSentinels(current)
})

test('cleanup proof rejects a missing prior bootstrap after its binding was cleared', async () => {
  const current = await stoppedProcessFixture(null)
  const attempts = new AttemptRepository(current.basePath)
  const attempt = await attempts.get('attempt-test')
  if (!attempt) throw new Error('Fixture attempt is missing')
  await attempts.update(attempt.id, attempt.revision, value => ({ ...value, process_id: null, started_at: null }))
  const root = join(current.basePath, '.threados/runs/run-test/attempts/attempt-test')
  await rm(await processRecordPath(current.basePath, 'run-test', 'attempt-test', 'process-test'))
  await writeFile(join(root, 'bootstrap-0.json'), JSON.stringify({
    workspace_id: current.workspace.id, attempt_id: 'attempt-test', index: 0, status: 'success',
  }))
  await expect(current.ops.mutate('clean', current.workspace.id, context('missing-prior-bootstrap')))
    .rejects.toMatchObject({ code: 'WORKSPACE_NOT_CLEANABLE' })
  await preservedFixtureSentinels(current)
})

test('cleanup proof rejects orphan bootstrap execution evidence without a run or attempt', async () => {
  const current = await fixture()
  const root = join(current.basePath, '.threados/runs/run-test/attempts/attempt-test')
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'bootstrap-0.json'), JSON.stringify({
    workspace_id: current.workspace.id, attempt_id: 'attempt-test', index: 0, status: 'success',
  }))
  await expect(current.ops.mutate('clean', current.workspace.id, context('orphan-bootstrap')))
    .rejects.toMatchObject({ code: 'WORKSPACE_NOT_CLEANABLE' })
  await preservedFixtureSentinels(current)
})

test('cleanup proof rejects inaccessible process-group evidence', async () => {
  const pid = 2_000_000_000
  const current = await stoppedProcessFixture(pid)
  const originalKill = process.kill
  try {
    process.kill = ((target, signal) => {
      if (Math.abs(target) === pid && signal === 0) {
        throw Object.assign(new Error('Fixture process observation is unavailable'), { code: 'EPERM' })
      }
      return originalKill(target, signal)
    }) as typeof process.kill
    await expect(current.ops.mutate('clean', current.workspace.id, context('inaccessible-group')))
      .rejects.toMatchObject({ code: 'WORKSPACE_NOT_CLEANABLE' })
    await preservedFixtureSentinels(current)
  } finally { process.kill = originalKill }
})

test.each(['workspace', 'cwd', 'provider', 'handle'] as const)(
  'cleanup proof rejects inconsistent %s process authority', async field => {
    const current = await stoppedProcessFixture(2_000_000_000)
    const record = await current.repository.get('process-test')
    if (!record) throw new Error('Fixture process is missing')
    await current.repository.update(record.id, record.revision, value => ({
      ...value,
      ...(field === 'workspace' ? { workspace_id: 'other-workspace' } : {}),
      ...(field === 'cwd' ? { cwd: current.basePath } : {}),
      ...(field === 'provider' ? { provider: 'mprocs-legacy' as const } : {}),
      ...(field === 'handle' ? { provider_handle: 'unknown' } : {}),
    }))
    await expect(current.ops.mutate('clean', current.workspace.id, context(`bad-${field}`)))
      .rejects.toMatchObject({ code: 'WORKSPACE_NOT_CLEANABLE' })
    await preservedFixtureSentinels(current)
  },
)

test.each(['workspace-id', 'normalized-cwd', 'quarantined-owner', 'copied-identity'] as const)(
  'cleanup proof rejects a live cross-bound process claiming %s', async association => {
    const current = await stoppedProcessFixture(2_000_000_000)
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)'], {
      cwd: current.workspace.root_path, detached: process.platform !== 'win32', stdio: 'ignore',
    })
    const closed = new Promise<void>(resolve => child.once('close', () => resolve()))
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve)
        child.once('error', reject)
      })
      if (!child.pid) throw new Error('Owned fixture child has no PID')
      const run = await new RunRepository(current.basePath).get('run-test')
      const attempt = await new AttemptRepository(current.basePath).get('attempt-test')
      const originalProcess = await current.repository.get('process-test')
      if (!run || !attempt || !originalProcess) throw new Error('Canonical fixture records are missing')
      await new RunRepository(current.basePath).create({ ...run, id: 'run-other', attempt_ids: ['attempt-other'] })
      await new AttemptRepository(current.basePath).create({ ...attempt, id: 'attempt-other', workflow_run_id: 'run-other', process_id: 'process-other' })
      const foreign = { ...originalProcess, id: 'process-other', workflow_run_id: 'run-other', attempt_id: 'attempt-other',
        pid: child.pid, provider_handle: `pid:${child.pid}`, status: 'running' as const, ended_at: null,
        workspace_id: association === 'normalized-cwd' ? 'other-workspace' : current.workspace.id,
        cwd: association === 'workspace-id' ? current.basePath : `${current.workspace.root_path}/.`,
      }
      await current.repository.create(foreign)
      if (association === 'quarantined-owner' || association === 'copied-identity') {
        await writeFile(await processRecordPath(current.basePath, 'run-other', 'attempt-other', foreign.id),
          JSON.stringify(association === 'copied-identity' ? { ...foreign, id: originalProcess.id }
            : { ...foreign, attempt_id: 'wrong-attempt' }))
        expect((await current.repository.list()).some(record => record.id === foreign.id)).toBe(false)
      }
      await expect(current.ops.mutate('clean', current.workspace.id, context(`cross-${association}`)))
        .rejects.toMatchObject({ code: 'WORKSPACE_NOT_CLEANABLE' })
      expect(child.exitCode).toBeNull()
      expect(process.kill(child.pid, 0)).toBe(true)
      await preservedFixtureSentinels(current)
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await closed
    }
  },
)

test('cleanup proof does not attribute opaque unrelated process JSON to an unused workspace', async () => {
  const current = await fixture()
  const directory = join(current.basePath, '.threados/runs/unrelated/attempts/unrelated/processes')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'unrelated.json'), '{unrelated opaque data')
  expect((await current.ops.mutate('clean', current.workspace.id, context('unrelated-opaque'))).workspace.status).toBe('cleaned')
  expect(await readFile(join(current.basePath, 'source.txt'), 'utf8')).toBe('original')
})

test.skipIf(process.platform === 'win32' || !Bun.which('python3'))(
  'cleanup proof retains the workspace after its leader is reaped until every owned group member exits',
  async () => {
    const current = await fixture()
    const outside = await createFixtureRoot('threados-cleanup-outside-'); roots.push(outside)
    await writeFile(join(outside, 'sentinel.txt'), 'outside sentinel')
    const controller = Bun.spawn(['python3', '-u', join(import.meta.dir, '../../test/fixtures/process/owned-process-group.py'), current.workspace.root_path], {
      stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
    })
    const reader = controller.stdout.getReader()
    let buffered = ''
    async function line(): Promise<Record<string, number | boolean>> {
      while (!buffered.includes('\n')) {
        const chunk = await reader.read()
        if (chunk.done) throw new Error('Owned process controller exited before its evidence')
        buffered += new TextDecoder().decode(chunk.value)
      }
      const index = buffered.indexOf('\n')
      const result = JSON.parse(buffered.slice(0, index)) as Record<string, number | boolean>
      buffered = buffered.slice(index + 1)
      return result
    }
    try {
      const launched = await line()
      const leader = Number(launched.leader)
      const worker = Number(launched.worker)
      expect(launched.pgid).toBe(leader)
      await persistAttempt(current.basePath, current.workspace.id, current.workspace.snapshot_id, 'completed', 'exited')
      const processes = new ProcessRepository(current.basePath)
      const record = await processes.get('process-test')
      if (!record) throw new Error('Fixture process is missing')
      await processes.update(record.id, record.revision, value => ({
        ...value, pid: leader, provider_handle: `pid:${leader}`, workspace_id: current.workspace.id, cwd: current.workspace.root_path,
      }))
      controller.stdin.write('reap-leader\n'); await controller.stdin.flush()
      expect(await line()).toMatchObject({ leader_reaped: true, worker_live: true, worker_pgid: leader })
      expect(() => process.kill(leader, 0)).toThrow()
      expect(process.kill(worker, 0)).toBe(true)
      const service = await getThreadOSRuntimeService(current.basePath)
      await expect(service.cleanWorkspace(current.workspace.id, context('live-descendant')))
        .rejects.toMatchObject({ code: 'WORKSPACE_NOT_CLEANABLE' })
      expect(process.kill(worker, 0)).toBe(true)
      await preservedFixtureSentinels(current)
      controller.stdin.write('reap-all\n'); await controller.stdin.flush(); controller.stdin.end()
      expect(await line()).toMatchObject({ all_owned_children_reaped: true })
      expect(await controller.exited).toBe(0)
      expect((await service.cleanWorkspace(current.workspace.id, context('group-reaped'))).workspace.status).toBe('cleaned')
      expect(await readFile(join(current.basePath, 'source.txt'), 'utf8')).toBe('original')
      expect(await readFile(join(outside, 'sentinel.txt'), 'utf8')).toBe('outside sentinel')
    } finally {
      controller.stdin.end()
      await controller.exited
    }
  },
)

test('real workspace inspect, retain and clean preserve canonical and replay safely', async () => {
  const { basePath, workspace, ops } = await fixture()
  expect((await ops.inspect(workspace.id)).verification.manifestMatches).toBe(true)
  await writeFile(join(workspace.root_path, 'source.txt'), 'agent output')
  expect((await ops.inspect(workspace.id)).verification.hasUsefulOutput).toBe(true)
  expect((await ops.mutate('retain', workspace.id, context('retain'))).workspace.status).toBe('retained')
  expect((await ops.mutate('clean', workspace.id, context('clean'))).workspace.status).toBe('cleaned')
  expect((await ops.mutate('clean', workspace.id, context('clean'))).workspace.status).toBe('cleaned')
  expect(await readFile(join(basePath, 'source.txt'), 'utf8')).toBe('original')
  await expect(ops.mutate('retain', workspace.id, context('clean'))).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
})

test('concurrent service instances coalesce the same cleanup command through its durable receipt', async () => {
  const { basePath, workspace } = await fixture()
  const first = new WorkspaceOperations(basePath)
  const second = new WorkspaceOperations(basePath)
  const [left, right] = await Promise.all([
    first.mutate('clean', workspace.id, context('shared-clean')),
    second.mutate('clean', workspace.id, context('shared-clean')),
  ])
  expect(left.workspace.status).toBe('cleaned')
  expect(right.workspace.status).toBe('cleaned')
})

test('active workspace cannot be cleaned or retained and SAFE cleanup requires confirmation', async () => {
  const { basePath, workspace, ops } = await fixture()
  await expect(ops.mutate('clean', workspace.id, { ...context('unconfirmed'), policyConfirmed: false })).rejects.toMatchObject({ code: 'POLICY_CONFIRMATION_REQUIRED' })
  await new WorkspaceRepository(basePath).update(workspace.id, workspace.revision, current => ({ ...current, status: 'active' }))
  for (const action of ['clean', 'retain'] as const) await expect(ops.mutate(action, workspace.id, context(action))).rejects.toMatchObject({ code: 'WORKSPACE_NOT_CLEANABLE' })
})

test('provisioning attempts and live processes block cleanup', async () => {
  const provisioning = await fixture()
  await persistAttempt(
    provisioning.basePath,
    provisioning.workspace.id,
    provisioning.workspace.snapshot_id,
    'provisioning',
  )
  await expect(
    provisioning.ops.mutate('clean', provisioning.workspace.id, context('provisioning')),
  ).rejects.toMatchObject({ code: 'WORKSPACE_NOT_CLEANABLE' })

  const live = await fixture()
  await persistAttempt(
    live.basePath,
    live.workspace.id,
    live.workspace.snapshot_id,
    'completed',
    'exited',
  )
  await expect(
    live.ops.mutate('clean', live.workspace.id, context('live-process')),
  ).rejects.toMatchObject({ code: 'WORKSPACE_NOT_CLEANABLE' })
})

test('terminal review and timeout attempts may be cleaned', async () => {
  for (const status of ['needs_review', 'timed_out'] as const) {
    const { basePath, workspace, ops } = await fixture()
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'], {
      cwd: workspace.root_path, detached: process.platform !== 'win32', stdio: 'ignore',
    })
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', code => code === 0 ? resolve() : reject(new Error('Fixture child failed')))
    })
    if (!child.pid) throw new Error('Fixture child did not receive a PID')
    await persistAttempt(basePath, workspace.id, workspace.snapshot_id, status, 'exited')
    const processes = new ProcessRepository(basePath)
    const record = await processes.get('process-test')
    if (!record) throw new Error('Fixture process is missing')
    await processes.update(record.id, record.revision, value => ({ ...value,
      pid: child.pid!, provider_handle: `pid:${child.pid}`, workspace_id: workspace.id, cwd: workspace.root_path,
    }))
    if (process.platform === 'win32') {
      await expect(ops.mutate('clean', workspace.id, context(`clean-${status}`)))
        .rejects.toMatchObject({ code: 'WORKSPACE_NOT_CLEANABLE' })
      continue
    }
    const cleaned = await ops.mutate('clean', workspace.id, context(`clean-${status}`))
    expect(cleaned.workspace.status).toBe('cleaned')
  }
})

test('doctor returns sanitized storage diagnostics', async () => {
  const { workspace, ops } = await fixture()
  await rm(workspace.root_path, { recursive: true, force: true })
  const report = await ops.doctor()
  expect(report.healthy).toBe(false)
  expect(report.issues).toContainEqual(expect.objectContaining({
    workspaceId: workspace.id,
    path: null,
    message: 'workspace tree missing',
  }))
})

test('runtime service delegates workspace projection and run filtering', async () => {
  const { basePath, workspace } = await fixture()
  const service = await getThreadOSRuntimeService(basePath)
  expect((await service.listWorkspaces({ runId: 'run-test' }))[0].id).toBe(workspace.id)
  expect(await service.listWorkspaces({ runId: 'other' })).toEqual([])
  expect((await service.inspectWorkspace(workspace.id)).workspace.id).toBe(workspace.id)
  await expect(service.inspectWorkspace('../escape')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
})

import { afterEach, describe, expect, test } from 'bun:test'
import { readFile, realpath, writeFile } from 'fs/promises'
import { join } from 'path'
import { createPr11Fixture, listFixtureWorkspaces, type Pr11Fixture } from './pr11-workspace-test-helper'
import { readThreadSurfaceState } from '@/lib/thread-surfaces/repository'
import { ChangeSetRepository } from '@/lib/changesets/repository'
import { ChangeSetContentStore } from '@/lib/changesets/content-store'
import { readLocalWorkspace } from '@/lib/local-first/workspace'
import { resolveWorkspaceRuntimePaths } from '@/lib/workspaces/paths'
import { readGateDecisions } from '@/lib/gates/repository'
import { ProcessRepository } from '@/lib/runtime/process-repository'
import { RunRepository } from '@/lib/runtime/run-repository'

let fixture: Pr11Fixture | null = null
afterEach(async () => { await fixture?.cleanup(); fixture = null })

describe('PR-11 isolated attempt dispatch', () => {
  test('a write fixture mutates only its verified THREADOS_SCOPED workspace', async () => {
    fixture = await createPr11Fixture(['write-one'])
    const outcome = await fixture.run()
    const [workspace] = await listFixtureWorkspaces(fixture.canonical)

    expect(outcome.run.status).toBe('successful')
    expect(outcome.attempts[0]).toMatchObject({
      baseline_snapshot_id: outcome.run.baseline_snapshot_id,
      workspace_id: workspace!.id,
      change_set_id: `change-set-${outcome.attempts[0]!.id}`,
    })
    const local = await readLocalWorkspace(fixture.canonical)
    const namespace = resolveWorkspaceRuntimePaths(
      fixture.runtime, local.id, await realpath(fixture.canonical),
    ).workspaceNamespace
    const changeSet = await new ChangeSetRepository({
      canonicalRoot: fixture.canonical, runtimeDataRoot: fixture.runtime, namespace,
      runId: outcome.run.id, attemptId: outcome.attempts[0]!.id,
    }).get(outcome.attempts[0]!.change_set_id!)
    const written = changeSet?.entries.find(entry => entry.path === 'agent-write-one.txt')
    expect(written).toMatchObject({ operation: 'add', content_kind: 'text' })
    expect(await new ChangeSetContentStore(
      fixture.runtime, namespace, outcome.run.id, outcome.attempts[0]!.id,
    ).verify(written!.content_ref!, written!.after_sha256!)).toBe(true)
    const captureGates = (await readGateDecisions(fixture.canonical, outcome.run.id))
      .filter(decision => ['change_set_captured', 'path_scope_respected'].includes(decision.gate_type))
    expect(captureGates.map(decision => [decision.gate_type, decision.status])).toEqual([
      ['change_set_captured', 'PASS'], ['path_scope_respected', 'PASS'],
    ])
    expect(outcome.attempts[0]!.gate_decision_refs).toContain(captureGates[0]!.id)
    expect(workspace).toMatchObject({ isolation_label: 'THREADOS_SCOPED', status: 'retained' })
    const projectedAttempt = (await readThreadSurfaceState(fixture.canonical)).runs.find(
      run => run.attemptId === outcome.attempts[0]!.id,
    )
    expect(projectedAttempt).toMatchObject({
      workspaceId: workspace!.id,
      snapshotId: outcome.run.baseline_snapshot_id,
      provider: 'copy',
      isolationLabel: 'THREADOS_SCOPED',
      runStatus: 'successful',
    })
    expect(await readFile(join(workspace!.root_path, 'agent-write-one.txt'), 'utf8')).toBe('write-one\n')
    await expect(readFile(join(fixture.canonical, 'agent-write-one.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  }, 30_000)

  test('the real process runner receives the isolated OS cwd and identifier-only environment', async () => {
    fixture = await createPr11Fixture(['real'], undefined, true)

    const outcome = await fixture.run()
    const [workspace] = await listFixtureWorkspaces(fixture.canonical)
    expect(outcome.run.status).toBe('successful')
    expect(outcome.attempts[0]?.error_message).toBeNull()
    const context = JSON.parse(await readFile(join(
      workspace!.root_path,
      'agent-runtime-context.json',
    ), 'utf8'))

    expect(await readFile(join(workspace!.root_path, 'agent-real.txt'), 'utf8')).toBe('real-process\n')
    expect(context).toMatchObject({
      cwd: workspace!.root_path,
      workspaceId: workspace!.id,
      snapshotId: outcome.run.baseline_snapshot_id,
      attemptId: outcome.attempts[0]!.id,
    })
    expect(context.basePath).toBeUndefined()
    await expect(readFile(join(fixture.canonical, 'agent-real.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  }, 30_000)

  test('persisted step scope blocks an actual out-of-scope write', async () => {
    fixture = await createPr11Fixture(['scoped'])
    Object.assign(fixture.sequence.steps[0]!, { path_scopes: ['source.txt'] })
    const outcome = await fixture.run()
    expect(outcome.attempts[0]?.status).toBe('needs_review')
    expect(outcome.run.status).toBe('awaiting_review')
    expect((await readGateDecisions(fixture.canonical, outcome.run.id)).find(
      decision => decision.gate_type === 'path_scope_respected',
    )).toMatchObject({ status: 'BLOCK', reason_codes: ['PATH_SCOPE_VIOLATION'] })
  }, 30_000)
  test.each([
    ['output schema', 'missing-required-schema.json', undefined],
    ['completion contract', undefined, 'Produce verified evidence before completing'],
    ['both contracts', 'missing-required-schema.json', 'Produce verified evidence before completing'],
    ['no contracts', undefined, undefined],
  ] as const)('a successful real process respects validation requirements: %s', async (_label, outputContract, completionContract) => {
    fixture = await createPr11Fixture(['contract-proof'], undefined, true)
    fixture.sequence.steps[0]!.output_contract_ref = outputContract
    fixture.sequence.steps[0]!.completion_contract = completionContract

    const outcome = await fixture.run()
    const attempt = outcome.attempts[0]!
    const process = await new ProcessRepository(fixture.canonical).get(attempt.process_id!)
    expect(process).toMatchObject({ status: 'exited', exit_code: 0 })
    expect(process!.pid).toBeGreaterThan(0)
    const hasContract = Boolean(outputContract || completionContract)
    expect(outcome.run.status).toBe(hasContract ? 'awaiting_review' : 'successful')
    expect(attempt.status).toBe(hasContract ? 'needs_review' : 'completed')
    const decisions = await readGateDecisions(fixture.canonical, outcome.run.id)
    expect(decisions.filter(decision => decision.gate_type === 'output_schema_pass')).toEqual([
      expect.objectContaining({
        status: outputContract ? 'BLOCK' : 'PASS',
        reason_codes: outputContract ? ['SCHEMA_INVALID'] : [],
      }),
    ])
    expect(decisions.filter(decision => decision.gate_type === 'completion_contract_pass')).toEqual([
      expect.objectContaining({
        status: completionContract ? 'BLOCK' : 'PASS',
        reason_codes: completionContract ? ['CONTRACT_INCOMPLETE'] : [],
      }),
    ])
    if (outputContract) {
      await expect(readFile(join(fixture.canonical, outputContract))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  }, 30_000)

  test.each(['bootstrap', 'agent'] as const)('cancellation intent cannot conceal a lost %s launch with a live owned child', async purpose => {
    let child: { pid: number; kill(signal: NodeJS.Signals): void; exited: Promise<number> } | undefined
    fixture = await createPr11Fixture(['lost-launch'], async canonical => {
      child = Bun.spawn([process.execPath, '-e', 'setInterval(() => {}, 1000)'], { stdout: 'ignore', stderr: 'ignore' })
      const runs = new RunRepository(canonical)
      const [run] = await runs.list()
      await runs.update(run!.id, run!.revision, current => ({
        ...current, cancellation_requested_at: new Date().toISOString(),
      }))
      throw new Error('Owned process started but its provider failed before publishing the PID')
    })
    if (purpose === 'bootstrap') {
      const config = join(fixture.canonical, '.threados', 'workspace.yaml')
      await writeFile(config, (await readFile(config, 'utf8')).replace('bootstrap: []', 'bootstrap: [fixture-bootstrap prepare]'))
    }
    try {
      const outcome = await fixture.run()
      const processes = await new ProcessRepository(fixture.canonical).list()
      expect(child).toBeDefined()
      expect(() => process.kill(child!.pid, 0)).not.toThrow()
      expect(outcome.run.status).not.toBe('cancelled')
      expect(outcome.run.error_code).toBe('PROCESS_CONTROL_FAILED')
      expect(outcome.run.cancellation_requested_at).not.toBeNull()
      expect(outcome.attempts[0]!.status).not.toBe('cancelled')
      expect(outcome.attempts[0]!.agent_registration?.registration_id).toBe('fixture-agent-lost-launch')
      expect(processes).toHaveLength(1)
      expect(processes[0]).toMatchObject({
        status: 'lost', process_purpose: purpose, pid: null,
      })
    } finally {
      if (child) {
        child.kill('SIGKILL')
        await child.exited
      }
    }
  }, 30_000)
})

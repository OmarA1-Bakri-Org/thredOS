import { createFixtureRoot, removeFixtureTree } from '../helpers/remove-fixture-tree'
import { afterEach, describe, expect, test } from 'bun:test'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { cp, mkdir, writeFile } from 'fs/promises'
import { isAbsolute, join } from 'path'
import { appendApproval } from '@/lib/approvals/repository'
import { generateExportBundle } from '@/lib/exports/bundler'
import { ExportBundleSchema } from '@/lib/exports/schema'
import { readLocalWorkspace } from '@/lib/local-first/workspace'
import { loadWorkspaceConfig } from '@/lib/workspaces/config'
import { createDefaultWorkspaceConfig } from '@/lib/workspaces/config-schema'
import { inspectCanonicalManifest, captureSnapshot } from '@/lib/workspaces/snapshot'
import { SnapshotRepository } from '@/lib/workspaces/snapshot-repository'
import { scanNoGitWorktreeRuntime } from '@/scripts/verify/no-worktree-guard'
import {
  createPr11Fixture,
  listFixtureWorkspaces,
  type Pr11Fixture,
} from './pr11-workspace-test-helper'

const execFileAsync = promisify(execFile)
let fixture: Pr11Fixture | null = null
const extraRoots: string[] = []

afterEach(async () => {
  await fixture?.cleanup()
  fixture = null
  await Promise.all(extraRoots.splice(0).map(root => removeFixtureTree(root)))
})

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function redactedSnapshotRecord(record: Awaited<ReturnType<SnapshotRepository['get']>>) {
  if (!record) throw new Error('snapshot record was not found')
  return {
    ...record,
    source_root: '[redacted]',
    content_root: record.content_root == null ? null : '[redacted]',
  }
}

describe('Milestone 1 workspace release proof', () => {
  test('records one immutable baseline, two sequential isolated attempts, Git-optional capture, and export evidence', async () => {
    fixture = await createPr11Fixture(['candidate-a', 'candidate-b'], undefined, true)
    await execFileAsync('git', ['init'], { cwd: fixture.canonical, windowsHide: true })
    await execFileAsync('git', ['config', 'user.email', 'fixture@threados.local'], {
      cwd: fixture.canonical,
      windowsHide: true,
    })
    await execFileAsync('git', ['config', 'user.name', 'thredOS fixture'], {
      cwd: fixture.canonical,
      windowsHide: true,
    })
    await execFileAsync('git', ['add', 'source.txt'], { cwd: fixture.canonical, windowsHide: true })
    await execFileAsync('git', ['commit', '-m', 'fixture baseline'], {
      cwd: fixture.canonical,
      windowsHide: true,
    })
    await writeFile(join(fixture.canonical, 'source.txt'), 'dirty tracked baseline\n')
    await writeFile(join(fixture.canonical, 'untracked-user.txt'), 'dirty untracked baseline\n')

    const localWorkspace = await readLocalWorkspace(fixture.canonical)
    const config = await loadWorkspaceConfig(fixture.canonical)
    const manifestRequest = {
      canonicalRoot: fixture.canonical,
      runtimeDataRoot: localWorkspace.runtimeDataRoot,
      localWorkspaceId: localWorkspace.id,
      workflowRunId: 'm1-canonical-inspection',
      config,
    }
    const canonicalBefore = await inspectCanonicalManifest(manifestRequest)
    const outcome = await fixture.run()
    const canonicalAfter = await inspectCanonicalManifest(manifestRequest)
    const workspaces = await listFixtureWorkspaces(fixture.canonical)

    expect(outcome.run.strategy).toBe('sequential')
    expect(outcome.run.max_concurrency).toBe(1)
    expect(outcome.attempts).toHaveLength(2)
    expect(new Set(outcome.attempts.map(attempt => attempt.baseline_snapshot_id))).toEqual(
      new Set([outcome.run.baseline_snapshot_id]),
    )
    expect(new Set(workspaces.map(workspace => workspace.id)).size).toBe(2)
    expect(new Set(workspaces.map(workspace => workspace.root_path)).size).toBe(2)
    expect(workspaces.every(workspace => workspace.isolation_label === 'THREADOS_SCOPED')).toBe(true)
    expect(workspaces.every(workspace => workspace.snapshot_id === outcome.run.baseline_snapshot_id)).toBe(true)
    expect(canonicalAfter.rootManifestHash).toBe(canonicalBefore.rootManifestHash)

    const snapshotId = outcome.run.baseline_snapshot_id
    expect(snapshotId).not.toBeNull()
    const snapshotRepository = new SnapshotRepository(fixture.canonical)
    const snapshot = await snapshotRepository.get(snapshotId!)
    const snapshotManifest = await snapshotRepository.getManifest(snapshotId!)
    expect(snapshot).toMatchObject({
      git_dirty: true,
      root_manifest_hash: canonicalBefore.rootManifestHash,
      status: 'ready',
    })
    expect(snapshotManifest?.root_manifest_hash).toBe(canonicalBefore.rootManifestHash)
    expect(snapshotManifest?.entries.some(entry => entry.path === '.git')).toBe(false)
    expect(snapshotManifest?.entries.some(entry => entry.path === '.threados')).toBe(false)

    const nonGitRoot = await createFixtureRoot('threados-m1-non-git-')
    const nonGitRuntime = await createFixtureRoot('threados-m1-non-git-runtime-')
    extraRoots.push(nonGitRoot, nonGitRuntime)
    await cp(join(import.meta.dir, '..', 'fixtures', 'workspaces', 'snapshot-project'), nonGitRoot, {
      recursive: true,
    })
    await writeFile(join(nonGitRoot, 'non-git-user.txt'), 'non-git bytes\n')
    const nonGit = await captureSnapshot({
      canonicalRoot: nonGitRoot,
      runtimeDataRoot: nonGitRuntime,
      localWorkspaceId: 'm1-non-git',
      workflowRunId: 'm1-non-git-run',
      config: createDefaultWorkspaceConfig(),
    })
    expect(nonGit.snapshot.git_head).toBeNull()
    expect(nonGit.snapshot.git_dirty).toBeNull()

    await appendApproval(fixture.canonical, outcome.run.id, {
      id: 'approval-m1-export',
      action_type: 'side_effect',
      target_ref: outcome.attempts[0]!.id,
      requested_by: 'm1-proof',
      status: 'approved',
      approved_by: 'm1-proof',
      approved_at: new Date().toISOString(),
      notes: 'Proof-only approval evidence for export completeness.',
    })
    const bundle = ExportBundleSchema.parse(await generateExportBundle(fixture.canonical, outcome.run.id))
    expect(bundle.workflow_run?.id).toBe(outcome.run.id)
    expect(bundle.attempts).toHaveLength(2)
    expect(bundle.processes).toHaveLength(2)
    expect(bundle.snapshots).toHaveLength(1)
    expect(bundle.workspaces).toHaveLength(2)
    expect(bundle.gate_decisions.length).toBeGreaterThan(0)
    expect(bundle.approvals).toHaveLength(1)
    expect(bundle.trace_events.length).toBeGreaterThan(0)
    expect(bundle.processes.every(process => process.cwd === '[redacted]')).toBe(true)
    expect(bundle.workspaces.every(workspace => workspace.root_path === '[redacted]')).toBe(true)
    expect(bundle.snapshots.every(item => item.record.source_root === '[redacted]')).toBe(true)

    const noWorktreeReport = await scanNoGitWorktreeRuntime(process.cwd())
    const runtimeWorktreeViolations = bundle.processes.flatMap(process => {
      const invocation = [process.command, ...process.redacted_args].join(' ').toLocaleLowerCase('en-US')
      return /\bgit(?:\.exe)?\s+worktree\b|\bworktree\s+(?:add|remove)\b/.test(invocation)
        ? [{ process_id: process.id, invocation }]
        : []
    })
    const combinedNoWorktreeReport = {
      ...noWorktreeReport,
      passed: noWorktreeReport.passed && runtimeWorktreeViolations.length === 0,
      runtime_process_records_inspected: bundle.processes.length,
      runtime_violations: runtimeWorktreeViolations,
    }
    expect(combinedNoWorktreeReport.passed).toBe(true)
    expect(combinedNoWorktreeReport.runtime_process_records_inspected).toBe(2)

    const proofRoot = process.env.THREADOS_M1_PROOF_DIR
    if (proofRoot) {
      if (!isAbsolute(proofRoot)) throw new Error('THREADOS_M1_PROOF_DIR must be absolute')
      await mkdir(join(proofRoot, 'ui-proof'), { recursive: true })
      const [workspaceA, workspaceB] = bundle.workspaces
      await Promise.all([
        writeJson(join(proofRoot, 'snapshot.json'), redactedSnapshotRecord(snapshot)),
        writeJson(join(proofRoot, 'snapshot-manifest.json'), snapshotManifest),
        writeJson(join(proofRoot, 'workspace-a.json'), workspaceA),
        writeJson(join(proofRoot, 'workspace-b.json'), workspaceB),
        writeJson(join(proofRoot, 'canonical-before.manifest.json'), canonicalBefore),
        writeJson(join(proofRoot, 'canonical-after.manifest.json'), canonicalAfter),
        writeJson(join(proofRoot, 'isolation-proof.json'), {
          schema_version: 1,
          passed: true,
          scheduler: 'sequential',
          max_concurrency: 1,
          same_snapshot_id: new Set(outcome.attempts.map(attempt => attempt.baseline_snapshot_id)).size === 1,
          same_root_manifest_hash: workspaces.every(
            workspace => workspace.manifest_hash === snapshot?.root_manifest_hash,
          ),
          distinct_workspace_ids: new Set(workspaces.map(workspace => workspace.id)).size === 2,
          distinct_workspace_roots: new Set(workspaces.map(workspace => workspace.root_path)).size === 2,
          canonical_unchanged: canonicalBefore.rootManifestHash === canonicalAfter.rootManifestHash,
          isolation_labels: workspaces.map(workspace => workspace.isolation_label),
        }),
        writeJson(join(proofRoot, 'dirty-git-proof.json'), {
          schema_version: 1,
          passed: snapshot?.git_dirty === true,
          git_head_present: snapshot?.git_head != null,
          dirty: snapshot?.git_dirty,
          tracked_dirty_entry_captured: snapshotManifest?.entries.some(entry => entry.path === 'source.txt'),
          untracked_entry_captured: snapshotManifest?.entries.some(entry => entry.path === 'untracked-user.txt'),
          git_metadata_excluded: !snapshotManifest?.entries.some(entry => entry.path === '.git'),
        }),
        writeJson(join(proofRoot, 'non-git-proof.json'), {
          schema_version: 1,
          passed: nonGit.snapshot.git_head == null && nonGit.snapshot.git_dirty == null,
          git_head: null,
          git_dirty: null,
          root_manifest_hash: nonGit.snapshot.root_manifest_hash,
          file_count: nonGit.snapshot.file_count,
        }),
        writeJson(join(proofRoot, 'no-worktree-report.json'), combinedNoWorktreeReport),
        writeJson(join(proofRoot, 'export-bundle.json'), bundle),
        writeJson(join(proofRoot, 'ui-proof', 'reference.json'), {
          schema_version: 1,
          status: 'pending_integration',
          required_test: 'test/ui/workspace-inspector.e2e.ts',
          evidence_ref: null,
        }),
        writeFile(
          join(proofRoot, 'test-results.txt'),
          'The programmatic M1 fixture completed. The verification runner replaces this file with command evidence.\n',
          'utf8',
        ),
      ])
    }
  }, 60_000)
})

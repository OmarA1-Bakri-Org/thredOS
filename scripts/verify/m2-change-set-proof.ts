#!/usr/bin/env bun

/**
 * Milestone 2 release proof. Evidence is deliberately incremental: an absent
 * capability or artifact leaves a failed phase rather than a partial green run.
 */
import { spawnSync } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, statSync, writeFileSync } from 'fs'
import { isAbsolute, join, resolve } from 'path'
import { readFile, writeFile } from 'fs/promises'
import { createPr11Fixture, type Pr11Fixture } from '../../test/integration/pr11-workspace-test-helper'
import { getThreadOSRuntimeService } from '../../lib/runtime/factory'
import { MergeRecordRepository } from '../../lib/merge/repository'
import { WorkspaceRepository } from '../../lib/workspaces/repository'
import { scanNoGitWorktreeRuntime } from './no-worktree-guard'

const repositoryRoot = resolve(import.meta.dir, '..', '..')
const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const proofRoot = join(repositoryRoot, 'test-results', 'verify', 'm2', timestamp, 'm2-proof')
const phasePath = join(proofRoot, 'phases.json')
const commandPath = join(proofRoot, 'test-results.txt')
const sourcePath = join(proofRoot, 'source-digest.json')
let sourceBefore: { digest: string; file_count: number } | null = null

type Phase = { name: string; status: 'passed' | 'failed'; error_code: string | null; detail: Record<string, unknown> }
const phases: Phase[] = []
const commands: { label: string; command: string; exit_code: number; output: string }[] = []
const variantPhases = [
  'real isolated writer and capture',
  'canonical user edit after baseline',
  'operator selection',
  'three-input isolated preview',
  'configured validation only in preview',
  'exact approval bound to validated plan',
  'transactional apply preserves unrelated user edit',
  'rollback precondition and reversal',
]
const requiredPhases = [
  ...(['dirty-git', 'non-git'] as const).flatMap(kind => variantPhases.map(name => `${kind}: ${name}`)),
  'production Git worktree guard',
  'targeted M2 contracts',
  'full repository check',
  'production build',
  'M2 operator UI',
  'M2 local operator verification',
]
const requiredVariantArtifacts = [
  'capture.json', 'canonical-user-edit.json', 'preview.json', 'validation.json',
  'approval.json', 'apply.json', 'rollback.json',
]

function savePhases(): void {
  const passed = new Set(phases.filter(item => item.status === 'passed').map(item => item.name))
  const pending = requiredPhases.filter(name => !passed.has(name))
  writeFileSync(phasePath, `${JSON.stringify({ schema_version: 1,
    status: phases.some(item => item.status === 'failed') ? 'failed' : pending.length === 0 ? 'passed' : 'in_progress',
    required_phases: requiredPhases, pending_phases: pending, phases }, null, 2)}\n`)
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code
  return error instanceof Error ? error.message.split(':')[0] || 'M2_PROOF_ERROR' : 'M2_PROOF_ERROR'
}

async function phase<T>(name: string, run: () => Promise<{ value: T; detail: Record<string, unknown> }>): Promise<T> {
  console.log(`[verify:m2] ${name}`)
  try {
    const { value, detail } = await run()
    phases.push({ name, status: 'passed', error_code: null, detail })
    savePhases()
    return value
  } catch (error) {
    phases.push({ name, status: 'failed', error_code: errorCode(error), detail: {} })
    savePhases()
    throw error
  }
}

function assert(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code)
}

function writeVariantEvidence(kind: 'dirty-git' | 'non-git', name: string, value: unknown): void {
  const root = join(proofRoot, 'variants', kind)
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`)
}

function digest(bytes: string): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function sourceDigest(): { digest: string; file_count: number } {
  const listing = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: repositoryRoot, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024,
  })
  assert(listing.status === 0 && typeof listing.stdout === 'string', 'M2_SOURCE_DIGEST_UNAVAILABLE')
  const paths = [...new Set(listing.stdout.split('\0').filter(Boolean))]
    .filter(path => !/^(?:\.omx|\.token-optimizer|test-results)\//.test(path.replaceAll('\\', '/')))
    .sort()
  const hasher = createHash('sha256')
  for (const relativePath of paths) {
    const absolute = join(repositoryRoot, relativePath)
    const stat = lstatSync(absolute)
    const bytes = stat.isSymbolicLink() ? Buffer.from(readlinkSync(absolute))
      : stat.isFile() ? readFileSync(absolute) : null
    assert(bytes, 'M2_SOURCE_DIGEST_UNSAFE_ENTRY')
    hasher.update(relativePath).update('\0').update(bytes).update('\0')
  }
  return { digest: `sha256:${hasher.digest('hex')}`, file_count: paths.length }
}

function recordSourceAfter(): void {
  if (!sourceBefore) return
  const after = sourceDigest()
  const matched = after.digest === sourceBefore.digest && after.file_count === sourceBefore.file_count
  writeFileSync(sourcePath, `${JSON.stringify({ schema_version: 1, before: sourceBefore,
    after, matched }, null, 2)}\n`)
  assert(matched, 'M2_SOURCE_CHANGED_DURING_PROOF')
}

function runCommand(label: string, args: string[], executable = 'bun', cwd = repositoryRoot): void {
  const command = `${executable} ${args.join(' ')}`
  console.log(`[verify:m2] ${label}: ${command}`)
  const env = { ...process.env }
  delete env.THREDOS_BASE_PATH
  delete env.THREADOS_BASE_PATH
  const result = spawnSync(executable, args, { cwd, env, encoding: 'utf8', windowsHide: true,
    maxBuffer: 100 * 1024 * 1024 })
  const output = [result.stdout ?? '', result.stderr ?? '', result.error?.message ?? ''].join('')
  const exitCode = result.status ?? 1
  commands.push({ label, command, exit_code: exitCode, output })
  writeFileSync(commandPath, commands.map(item => [
    `Label: ${item.label}`, `Command: ${item.command}`, `Exit code: ${item.exit_code}`,
    item.output.trimEnd(), '',
  ].join('\n')).join('\n'))
  if (exitCode !== 0) throw new Error(`M2_COMMAND_FAILED_${label.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`)
}

async function prepareValidationScript(fixture: Pr11Fixture): Promise<void> {
  await writeFile(join(fixture.canonical, 'validate.cjs'), [
    "const fs = require('fs')",
    "if (!fs.existsSync('agent-real.txt')) process.exit(21)",
    "if (fs.readFileSync('source.txt', 'utf8') !== 'user-later-edit\\n') process.exit(22)",
    "if (!fs.existsSync('user-later.txt')) process.exit(23)",
  ].join('\n'))
}

async function enablePreviewValidation(fixture: Pr11Fixture): Promise<void> {
  const configPath = join(fixture.canonical, '.threados', 'workspace.yaml')
  const config = await readFile(configPath, 'utf8')
  assert(config.includes('validate: []'), 'M2_FIXTURE_VALIDATION_CONFIG_CHANGED')
  await writeFile(configPath, config.replace('validate: []', 'validate:\n  - node validate.cjs'))
}

async function configureDirtyGit(fixture: Pr11Fixture): Promise<void> {
  const cwd = fixture.canonical
  for (const [label, args] of [
    ['init', ['init']], ['fixture author email', ['config', 'user.email', 'fixture@threados.local']],
    ['fixture author name', ['config', 'user.name', 'thredOS fixture']],
    ['baseline add', ['add', 'source.txt']], ['baseline commit', ['commit', '-m', 'fixture baseline']],
  ] as const) runCommand(`dirty Git fixture: ${label}`, [...args], 'git', cwd)
  await writeFile(join(cwd, 'source.txt'), 'dirty-baseline\n')
  await writeFile(join(cwd, 'untracked-before.txt'), 'untracked baseline\n')
}

async function proofVariant(kind: 'dirty-git' | 'non-git'): Promise<void> {
  const fixture = await createPr11Fixture([`m2-${kind}`], undefined, true)
  try {
    await prepareValidationScript(fixture)
    if (kind === 'dirty-git') await configureDirtyGit(fixture)
    else assert(!existsSync(join(fixture.canonical, '.git')), 'M2_NON_GIT_FIXTURE_HAS_GIT')

    const run = await phase(`${kind}: real isolated writer and capture`, async () => {
      const value = await fixture.run()
      const attempt = value.attempts[0]
      assert(value.run.strategy === 'sequential' && value.run.max_concurrency === 1, 'M2_SCHEDULER_NOT_SEQUENTIAL')
      assert(attempt?.status === 'completed' && !!attempt.change_set_id, 'M2_CHANGE_SET_NOT_CAPTURED')
      const service = await getThreadOSRuntimeService(fixture.canonical)
      const inspected = await service.inspectChangeSetById(attempt.change_set_id)
      assert(inspected.summary.validation.status === 'passed', 'M2_CHANGE_SET_GATE_NOT_PASSED')
      assert(inspected.summary.output_contract_state === 'passed', 'M2_OUTPUT_CONTRACT_NOT_PASSED')
      assert(inspected.entries.some(entry => entry.path === 'agent-real.txt'), 'M2_REAL_PROCESS_OUTPUT_MISSING')
      assert(!existsSync(join(fixture.canonical, 'agent-real.txt')), 'M2_AGENT_WROTE_CANONICAL')
      assert(attempt.workspace_id, 'M2_ATTEMPT_WORKSPACE_MISSING')
      const workspace = await new WorkspaceRepository(fixture.canonical).get(attempt.workspace_id)
      assert(workspace?.isolation_label === 'THREADOS_SCOPED', 'M2_ISOLATION_LABEL_INCORRECT')
      const context = JSON.parse(await readFile(join(workspace.root_path, 'agent-runtime-context.json'), 'utf8')) as {
        cwd?: string; workspaceId?: string; snapshotId?: string; attemptId?: string
      }
      assert(context.cwd === workspace.root_path && context.workspaceId === workspace.id
        && context.snapshotId === value.run.baseline_snapshot_id && context.attemptId === attempt.id,
      'M2_REAL_PROCESS_WORKSPACE_BINDING_FAILED')
      writeVariantEvidence(kind, 'capture', {
        schema_version: 1, run_id: value.run.id, attempt_id: attempt.id,
        change_set_id: attempt.change_set_id, baseline_snapshot_id: value.run.baseline_snapshot_id,
        change_set_status: inspected.summary.status, validation_status: inspected.summary.validation.status,
        output_contract_state: inspected.summary.output_contract_state,
        real_process_workspace_binding: true, isolation_label: workspace.isolation_label,
        changed_paths: inspected.entries.map(entry => ({ path: entry.path, operation: entry.operation,
          before_sha256: entry.before_sha256, after_sha256: entry.after_sha256 })),
      })
      return { value, detail: { run_id: value.run.id, attempt_id: attempt.id,
        change_set_id: attempt.change_set_id, baseline_snapshot_id: value.run.baseline_snapshot_id,
        isolation_label: workspace.isolation_label, real_process_workspace_binding: true,
        canonical_agent_output_absent: true } }
    })
    const attempt = run.attempts[0]!
    const service = await getThreadOSRuntimeService(fixture.canonical)
    await phase(`${kind}: canonical user edit after baseline`, async () => {
      await writeFile(join(fixture.canonical, 'source.txt'), 'user-later-edit\n')
      await writeFile(join(fixture.canonical, 'user-later.txt'), 'unrelated user work\n')
      await enablePreviewValidation(fixture)
      assert(await readFile(join(fixture.canonical, 'source.txt'), 'utf8') === 'user-later-edit\n',
        'M2_CANONICAL_USER_EDIT_NOT_PRESENT')
      writeVariantEvidence(kind, 'canonical-user-edit', { schema_version: 1,
        source_sha256: digest(await readFile(join(fixture.canonical, 'source.txt'), 'utf8')),
        unrelated_sha256: digest(await readFile(join(fixture.canonical, 'user-later.txt'), 'utf8')) })
      return { value: null, detail: { existing_file_changed: true, unrelated_file_added: true } }
    })
    const selected = await phase(`${kind}: operator selection`, async () => {
      const inspected = await service.inspectChangeSetById(attempt.change_set_id!)
      const value = await service.selectChangeSetById({ changeSetId: attempt.change_set_id!,
        expectedRevision: inspected.summary.revision }, { actor: 'm2-proof-operator', interface: 'api',
        idempotencyKey: `m2-select-${kind}`, policyConfirmed: true })
      assert(value.status === 'selected', 'M2_CANDIDATE_NOT_SELECTED')
      return { value, detail: { change_set_id: value.id, revision: value.revision, status: value.status } }
    })
    const preview = await phase(`${kind}: three-input isolated preview`, async () => {
      const value = await service.previewSelectedChangeSet(selected.id, { actor: 'm2-proof-operator',
        interface: 'api', idempotencyKey: `m2-preview-${kind}`, policyConfirmed: true })
      assert(value.plan.status === 'ready', 'M2_PREVIEW_NOT_READY')
      assert(value.plan.conflicts.length === 0, 'M2_UNEXPECTED_CONFLICT')
      const previewRecord = await new MergeRecordRepository(fixture.runtime).getPreview(value.preview_id)
      assert(previewRecord?.status === 'ready', 'M2_PREVIEW_RECORD_NOT_READY')
      assert(isAbsolute(previewRecord.root_path) && previewRecord.root_path !== fixture.canonical,
        'M2_PREVIEW_NOT_ISOLATED')
      assert(await readFile(join(previewRecord.root_path, 'source.txt'), 'utf8') === 'user-later-edit\n',
        'M2_PREVIEW_LOST_USER_EDIT')
      assert(await readFile(join(previewRecord.root_path, 'agent-real.txt'), 'utf8') === 'real-process\n',
        'M2_PREVIEW_LOST_CANDIDATE')
      assert(await readFile(join(previewRecord.root_path, 'user-later.txt'), 'utf8') === 'unrelated user work\n',
        'M2_PREVIEW_LOST_UNRELATED_FILE')
      assert(!existsSync(join(fixture.canonical, 'agent-real.txt')), 'M2_PREVIEW_MUTATED_CANONICAL')
      writeVariantEvidence(kind, 'preview', { schema_version: 1,
        plan_id: value.plan.id, preview_id: value.preview_id,
        baseline_snapshot_id: value.plan.baseline_snapshot_id,
        canonical_precondition_hash: value.plan.canonical_precondition_hash,
        change_set_ids: value.plan.change_set_ids, conflicts: value.plan.conflicts,
        preview_manifest: value.preview_manifest,
        source_sha256: digest(await readFile(join(previewRecord.root_path, 'source.txt'), 'utf8')),
        candidate_sha256: digest(await readFile(join(previewRecord.root_path, 'agent-real.txt'), 'utf8')),
        unrelated_sha256: digest(await readFile(join(previewRecord.root_path, 'user-later.txt'), 'utf8')),
      })
      return { value, detail: { plan_id: value.plan.id, preview_id: value.preview_id,
        baseline_snapshot_id: value.plan.baseline_snapshot_id,
        canonical_precondition_hash: value.plan.canonical_precondition_hash,
        candidate_preserved: true, user_edit_preserved: true, unrelated_file_preserved: true,
        canonical_agent_output_absent: true } }
    })
    const validated = await phase(`${kind}: configured validation only in preview`, async () => {
      let value
      try {
        value = await service.validateMergePlan(preview.plan.id, { actor: 'm2-proof-operator',
          interface: 'api', idempotencyKey: `m2-validate-${kind}`, policyConfirmed: true })
      } catch (error) {
        if (process.platform === 'win32' && errorCode(error) === 'MERGE_APPLY_CAPABILITY_UNAVAILABLE') {
          throw new Error('M2_WINDOWS_APPLY_CAPABILITY_UNAVAILABLE')
        }
        throw error
      }
      assert(value.status === 'validated', 'M2_PLAN_VALIDATION_NOT_PASSED')
      const record = await new MergeRecordRepository(fixture.runtime).getPreview(preview.preview_id)
      assert(record?.status === 'ready', 'M2_PREVIEW_MISSING_AFTER_VALIDATION')
      const evidencePath = join(fixture.runtime, 'merge-validations', value.id, '0.json')
      assert(existsSync(evidencePath), 'M2_VALIDATION_PROCESS_EVIDENCE_MISSING')
      const evidence = JSON.parse(readFileSync(evidencePath, 'utf8')) as {
        status?: string; cwd?: string; pid?: number; exit_code?: number
      }
      assert(evidence.status === 'passed' && evidence.exit_code === 0 && Number.isInteger(evidence.pid),
        'M2_VALIDATION_PROCESS_NOT_GREEN')
      assert(evidence.cwd === record.root_path, 'M2_VALIDATION_NOT_IN_PREVIEW')
      assert(!existsSync(join(fixture.canonical, 'agent-real.txt')), 'M2_VALIDATION_MUTATED_CANONICAL')
      writeVariantEvidence(kind, 'validation', { schema_version: 1, plan_id: value.id,
        command_status: evidence.status, exit_code: evidence.exit_code, pid_recorded: true,
        cwd_is_preview: true, canonical_agent_output_absent: true })
      return { value, detail: { plan_id: value.id, validation_status: evidence.status,
        validation_cwd_is_preview: true, pid_recorded: true, canonical_agent_output_absent: true } }
    })
    // Later M2 interfaces must bind approval to this exact validated plan and
    // provide an atomic apply result, rollback record, and stale rollback rejection.
    await phase(`${kind}: exact approval bound to validated plan`, async () => {
      void validated
      throw new Error('M2_EXACT_APPROVAL_PROOF_NOT_WIRED')
    })
  } finally {
    await fixture.cleanup()
  }
}

async function main(): Promise<void> {
  mkdirSync(proofRoot, { recursive: true })
  savePhases()
  writeFileSync(commandPath, '')
  console.log(`[verify:m2] evidence: ${proofRoot}`)
  assert(existsSync(join(repositoryRoot, 'package.json')), 'M2_REPOSITORY_ROOT_NOT_FOUND')
  sourceBefore = sourceDigest()
  writeFileSync(sourcePath, `${JSON.stringify({ schema_version: 1, before: sourceBefore,
    after: null, matched: false }, null, 2)}\n`)
  await proofVariant('dirty-git')
  await proofVariant('non-git')
  await phase('production Git worktree guard', async () => {
    const report = await scanNoGitWorktreeRuntime(repositoryRoot)
    writeFileSync(join(proofRoot, 'no-worktree-report.json'), `${JSON.stringify(report, null, 2)}\n`)
    assert(report.passed, 'M2_PRODUCTION_WORKTREE_VIOLATION')
    return { value: null, detail: { passed: true } }
  })
  for (const [label, args] of [
    ['targeted M2 contracts', ['test', '--max-concurrency=1', '--timeout=30000',
      'lib/changesets/capture.test.ts', 'lib/changesets/operations.test.ts',
      'lib/merge/preview.test.ts', 'lib/merge/runtime-operations.test.ts',
      'test/integration/change-set-review-parity.test.ts', 'test/integration/merge-runtime-parity.test.ts',
      'test/integration/m2-controlled-apply-parity.test.ts']],
    ['full repository check', ['run', 'check']],
    ['production build', ['run', 'build']],
    ['M2 operator UI', ['run', 'test:ui', '--', 'test/ui/m2-controlled-apply.e2e.ts']],
    ['M2 local operator verification', ['run', 'verify:local', '--', 'test/ui/m2-controlled-apply.e2e.ts']],
  ] as const) {
    await phase(label, async () => {
      if (label === 'targeted M2 contracts') {
        assert(existsSync(join(repositoryRoot, 'test', 'integration', 'm2-controlled-apply-parity.test.ts')),
          'M2_APPLY_PARITY_PROOF_MISSING')
      }
      if (label.includes('UI') || label.includes('local operator')) {
        assert(existsSync(join(repositoryRoot, 'test', 'ui', 'm2-controlled-apply.e2e.ts')),
          'M2_OPERATOR_UI_PROOF_MISSING')
      }
      runCommand(label, [...args])
      return { value: null, detail: { command: `bun ${args.join(' ')}`, exit_code: 0 } }
    })
  }
  assert(phases.every(item => item.status === 'passed'), 'M2_PROOF_HAS_FAILED_PHASE')
  assert(requiredPhases.every(name => phases.some(item => item.name === name && item.status === 'passed')),
    'M2_PROOF_PHASE_MISSING')
  for (const kind of ['dirty-git', 'non-git'] as const) {
    for (const name of requiredVariantArtifacts) {
      const path = join(proofRoot, 'variants', kind, name)
      assert(existsSync(path) && statSync(path).size > 0, `M2_ARTIFACT_MISSING_${kind}_${name}`)
    }
  }
  assert(statSync(commandPath).size > 0, 'M2_COMMAND_EVIDENCE_MISSING')
  recordSourceAfter()
  writeFileSync(join(proofRoot, 'result.json'), `${JSON.stringify({ schema_version: 1, status: 'passed',
    phase_count: phases.length, proof_root: proofRoot }, null, 2)}\n`)
  console.log(`[verify:m2] passed: ${proofRoot}`)
}

main().catch(error => {
  let code = errorCode(error)
  try { recordSourceAfter() } catch (sourceError) { code = errorCode(sourceError) }
  if (!phases.some(item => item.status === 'failed' && item.error_code === code)) {
    phases.push({ name: 'harness failure', status: 'failed', error_code: code, detail: {} })
    savePhases()
  }
  writeFileSync(join(proofRoot, 'result.json'), `${JSON.stringify({ schema_version: 1,
    status: 'failed', error_code: code, phase_count: phases.length }, null, 2)}\n`)
  console.error(`[verify:m2] failed: ${code}; evidence: ${proofRoot}`)
  process.exitCode = 1
})

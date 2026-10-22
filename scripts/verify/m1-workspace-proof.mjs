#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs'
import { join, relative, sep } from 'path'
import { spawnSync } from 'child_process'
import { verificationArtifactReferences, validateVerificationArtifactReferences } from './artifact-references.mjs'

const repositoryRoot = process.cwd()
const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const proofRoot = join(repositoryRoot, 'test-results', 'verify', 'm1', timestamp, 'm1-proof')
const requiredArtifacts = [
  'snapshot.json',
  'snapshot-manifest.json',
  'workspace-a.json',
  'workspace-b.json',
  'canonical-before.manifest.json',
  'canonical-after.manifest.json',
  'isolation-proof.json',
  'dirty-git-proof.json',
  'non-git-proof.json',
  'no-worktree-report.json',
  'export-bundle.json',
  'test-results.txt',
  'ui-proof/reference.json',
]
const completedCommands = []

function commandOutput(result) {
  return [
    result.stdout ?? '',
    result.stderr ?? '',
    result.error ? `${result.error.message}\n` : '',
  ].join('')
}

function run(label, args, extraEnv = {}) {
  const command = `bun ${args.join(' ')}`
  console.log(`[verify:m1] ${label}: ${command}`)
  const env = { ...process.env, ...extraEnv }
  delete env.THREDOS_BASE_PATH
  delete env.THREADOS_BASE_PATH
  const result = spawnSync('bun', args, {
    cwd: repositoryRoot,
    env,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 100 * 1024 * 1024,
  })
  const output = commandOutput(result)
  if (output.trim()) console.log(output.trimEnd())
  const record = { label, command, exitCode: result.status ?? 1, output }
  completedCommands.push(record)
  writeCommandEvidence(completedCommands)
  if (record.exitCode !== 0) {
    console.error(`[verify:m1] failed at ${label}; evidence: ${proofRoot}`)
    process.exit(1)
  }
  return record
}

function findWorkspaceApiTests() {
  const roots = [join(repositoryRoot, 'test', 'api'), join(repositoryRoot, 'app', 'api', 'workspaces')]
  const tests = []
  const visit = path => {
    if (!existsSync(path)) return
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) visit(child)
      if (!entry.isFile() || !/\.test\.[cm]?[jt]sx?$/.test(entry.name)) continue
      const source = readFileSync(child, 'utf8')
      if (source.includes('/api/workspaces') || source.includes('app/api/workspaces')) {
        tests.push(relative(repositoryRoot, child).split(sep).join('/'))
      }
    }
  }
  roots.forEach(visit)
  return [...new Set(tests)].sort()
}

function writeCommandEvidence(results) {
  const body = results.flatMap(result => [
    `Label: ${result.label}`,
    `Command: ${result.command}`,
    `Exit code: ${result.exitCode}`,
    '',
    result.output.trimEnd(),
    '',
  ]).join('\n')
  writeFileSync(join(proofRoot, 'test-results.txt'), `${body}\n`, 'utf8')
}

function validateArtifacts() {
  const missing = requiredArtifacts.filter(path => !existsSync(join(proofRoot, path)))
  const empty = requiredArtifacts.filter(path => {
    const absolute = join(proofRoot, path)
    return existsSync(absolute) && statSync(absolute).size === 0
  })
  if (missing.length > 0 || empty.length > 0) {
    throw new Error(`M1 proof bundle incomplete: missing=${missing.join(',')} empty=${empty.join(',')}`)
  }
  const isolation = JSON.parse(readFileSync(join(proofRoot, 'isolation-proof.json'), 'utf8'))
  const noWorktree = JSON.parse(readFileSync(join(proofRoot, 'no-worktree-report.json'), 'utf8'))
  const ui = JSON.parse(readFileSync(join(proofRoot, 'ui-proof', 'reference.json'), 'utf8'))
  if (!isolation.passed) throw new Error('M1 isolation proof did not pass')
  if (!noWorktree.passed) throw new Error('M1 no-worktree guard did not pass')
  if (ui.status !== 'passed') throw new Error('M1 workspace UI proof did not pass')
  validateVerificationArtifactReferences(ui.evidence_refs)
}

mkdirSync(join(proofRoot, 'ui-proof'), { recursive: true })
console.log(`[verify:m1] evidence: ${proofRoot}`)

const programmatic = run('programmatic workspace evidence', [
  'test',
  '--max-concurrency=1',
  '--timeout=30000',
  'test/architecture/no-git-worktree-runtime.test.ts',
  'test/integration/m1-workspace-release-proof.test.ts',
  'lib/exports/bundler.test.ts',
  'test/integration/snapshot-dirty-git.test.ts',
  'test/integration/snapshot-non-git.test.ts',
], { THREADOS_M1_PROOF_DIR: proofRoot })
const apiTests = findWorkspaceApiTests()
const operator = apiTests.length > 0
  ? run('workspace API, CLI, and component contracts', [
      'test',
      '--max-concurrency=1',
      '--timeout=30000',
      'lib/seqctl/commands/workspace.test.ts',
      'components/inspector/WorkspaceInspector.test.tsx',
      'test/integration/workspace-interface-parity.test.ts',
      ...apiTests,
    ])
  : {
      label: 'workspace API, CLI, and component contracts',
      command: 'bun test <workspace operator contracts>',
      exitCode: 1,
      output: 'No test exercising /api/workspaces was found.\n',
    }
if (operator.exitCode !== 0) {
  writeCommandEvidence([...completedCommands, operator])
  console.error(`[verify:m1] failed at workspace API, CLI, and component contracts; evidence: ${proofRoot}`)
  process.exit(1)
}
const check = run('full repository check', ['run', 'check'])
const build = run('production build', ['run', 'build'])
const ui = run('workspace inspector UI proof', [
  'run',
  'test:ui',
  '--',
  'test/ui/workspace-inspector.e2e.ts',
])
const local = run('workspace inspector local verification', [
  'run',
  'verify:local',
  '--',
  'test/ui/workspace-inspector.e2e.ts',
])
const results = [programmatic, operator, check, build, ui, local]

writeCommandEvidence(results)
writeFileSync(join(proofRoot, 'ui-proof', 'reference.json'), `${JSON.stringify({
  schema_version: 1,
  status: ui.exitCode === 0 && local.exitCode === 0 ? 'passed' : 'failed',
  required_test: 'test/ui/workspace-inspector.e2e.ts',
  commands: [ui.command, local.command],
  evidence_refs: [
    ...verificationArtifactReferences(ui.output, repositoryRoot, 'ui'),
    ...verificationArtifactReferences(local.output, repositoryRoot, 'local'),
  ],
}, null, 2)}\n`, 'utf8')

try {
  if (results.some(result => result.exitCode !== 0)) {
    throw new Error(`M1 verification command failed: ${results.filter(result => result.exitCode !== 0).map(result => result.label).join(', ')}`)
  }
  validateArtifacts()
  console.log(`[verify:m1] passed: ${proofRoot}`)
} catch (error) {
  console.error(`[verify:m1] failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}

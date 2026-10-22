import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, realpath, rm } from 'fs/promises'
import { join, sep } from 'path'
import { tmpdir } from 'os'
import type { WorkspaceDispatchContext } from '@/lib/runtime/workspace-planner'
import {
  parseBootstrapCommand,
  runWorkspaceBootstrap,
  WorkspaceBootstrapError,
  type BootstrapArtifact,
} from './bootstrap'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function roots(): Promise<{ canonical: string; workspace: string }> {
  const root = await mkdtemp(join(tmpdir(), 'threados-bootstrap-'))
  temporaryRoots.push(root)
  const canonical = join(root, 'canonical')
  const workspace = join(root, 'runtime', 'workspace', 'tree')
  await Promise.all([mkdir(canonical, { recursive: true }), mkdir(workspace, { recursive: true })])
  return { canonical: await realpath(canonical), workspace: await realpath(workspace) }
}

function context(cwd: string): WorkspaceDispatchContext {
  return {
    cwd,
    workspaceId: 'workspace-1',
    snapshotId: 'snapshot-1',
    attemptId: 'attempt-1',
    workflowRunId: 'run-1',
    isolationLabel: 'THREADOS_SCOPED',
    environment: {
      THREADOS_WORKSPACE_ID: 'workspace-1',
      THREADOS_SNAPSHOT_ID: 'snapshot-1',
      THREADOS_ATTEMPT_ID: 'attempt-1',
      THREADOS_RUN_ID: 'run-1',
      THREADOS_STEP_ID: 'step-1',
    },
    promptContext: {
      workspace_id: 'workspace-1',
      snapshot_id: 'snapshot-1',
      isolation_label: 'THREADOS_SCOPED',
      instruction: 'Operate only in the provided working directory.',
    },
  }
}

describe('parseBootstrapCommand', () => {
  test('parses direct argv without shell expansion', () => {
    expect(parseBootstrapCommand('bun install --frozen-lockfile')).toEqual({
      command: 'bun', args: ['install', '--frozen-lockfile'],
    })
    expect(parseBootstrapCommand('node "scripts/setup file.mjs" --name=\'local workspace\''))
      .toEqual({ command: 'node', args: ['scripts/setup file.mjs', '--name=local workspace'] })
  })

  test('rejects shell operators and malformed quoting', () => {
    expect(() => parseBootstrapCommand('bun install && npm test')).toThrow('shell operator')
    expect(() => parseBootstrapCommand('node "unterminated')).toThrow('unterminated')
  })
})

describe('runWorkspaceBootstrap', () => {
  test('evaluates, executes, bounds, redacts, and persists each command in the verified workspace', async () => {
    const paths = await roots()
    const policyCwds: string[] = []
    const launches: Array<{ cwd: string; shell: false; timeoutMs: number; maxOutputBytes: number }> = []
    const artifacts: BootstrapArtifact[] = []
    let tick = 1_000

    const result = await runWorkspaceBootstrap({
      commands: ['bun install --token=super-secret', 'bun run build'],
      canonicalRoot: paths.canonical,
      context: context(paths.workspace),
      maxOutputBytes: 48,
      timeoutMs: 12_000,
      nowMs: () => (tick += 25),
      evaluatePolicy: payload => {
        policyCwds.push(payload.cwd)
        return { allowed: true, confirmation_required: false }
      },
      execute: async (_payload, options) => {
        launches.push(options)
        return {
          exitCode: 0,
          stdout: 'token=should-not-leak ' + 'x'.repeat(100),
          stderr: 'password=hunter2',
        }
      },
      writeArtifact: async artifact => { artifacts.push(artifact) },
    })

    expect(result).toEqual(artifacts)
    expect(policyCwds).toEqual([paths.workspace, paths.workspace])
    expect(launches).toEqual([
      { cwd: paths.workspace, shell: false, timeoutMs: 12_000, maxOutputBytes: 48 },
      { cwd: paths.workspace, shell: false, timeoutMs: 12_000, maxOutputBytes: 48 },
    ])
    expect(artifacts).toHaveLength(2)
    expect(artifacts[0]).toMatchObject({
      schema_version: 1,
      workspace_id: 'workspace-1',
      attempt_id: 'attempt-1',
      index: 0,
      command: 'bun',
      args: ['install', '[REDACTED]'],
      duration_ms: 25,
      exit_code: 0,
      status: 'success',
    })
    expect(JSON.stringify(artifacts)).not.toContain('super-secret')
    expect(JSON.stringify(artifacts)).not.toContain('should-not-leak')
    expect(JSON.stringify(artifacts)).not.toContain('hunter2')
    expect(Buffer.byteLength(artifacts[0]!.stdout, 'utf8')).toBeLessThanOrEqual(48)
    expect(Buffer.byteLength(artifacts[0]!.stderr, 'utf8')).toBeLessThanOrEqual(48)
  })

  test('blocks policy denial before execution and persists the failure evidence', async () => {
    const paths = await roots()
    const artifacts: BootstrapArtifact[] = []
    let executed = false

    await expect(runWorkspaceBootstrap({
      commands: ['npm install'],
      canonicalRoot: paths.canonical,
      context: context(paths.workspace),
      evaluatePolicy: () => ({ allowed: false, confirmation_required: false, reason: 'not allowlisted' }),
      execute: async () => { executed = true; return { exitCode: 0, stdout: '', stderr: '' } },
      writeArtifact: async artifact => { artifacts.push(artifact) },
    })).rejects.toMatchObject({ code: 'WORKSPACE_BOOTSTRAP_FAILED', commandIndex: 0 })

    expect(executed).toBe(false)
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]).toMatchObject({ status: 'policy_blocked', exit_code: null })
  })

  test('persists a nonzero exit or executor error before throwing the typed failure', async () => {
    const paths = await roots()
    const artifacts: BootstrapArtifact[] = []

    await expect(runWorkspaceBootstrap({
      commands: ['bun run setup'],
      canonicalRoot: paths.canonical,
      context: context(paths.workspace),
      evaluatePolicy: () => ({ allowed: true, confirmation_required: false }),
      execute: async () => ({ exitCode: 2, stdout: '', stderr: 'token=bad' }),
      writeArtifact: async artifact => { artifacts.push(artifact) },
    })).rejects.toBeInstanceOf(WorkspaceBootstrapError)
    expect(artifacts[0]).toMatchObject({ status: 'failed', exit_code: 2, stderr: 'token=[REDACTED]' })
  })

  test('never accepts the canonical project as bootstrap cwd', async () => {
    const paths = await roots()
    await expect(runWorkspaceBootstrap({
      commands: ['bun install'],
      canonicalRoot: paths.canonical,
      context: context(paths.canonical),
      evaluatePolicy: () => ({ allowed: true, confirmation_required: false }),
      execute: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      writeArtifact: async () => {},
    })).rejects.toMatchObject({ code: 'WORKSPACE_BOOTSTRAP_FAILED' })
  })

  test('rejects relative roots and lexical dot-segment aliases before resolving them', async () => {
    const paths = await roots()
    const aliasedWorkspace = paths.workspace + sep + '..' + sep + 'tree'

    await expect(runWorkspaceBootstrap({
      commands: ['bun install'],
      canonicalRoot: paths.canonical,
      context: context(aliasedWorkspace),
      evaluatePolicy: () => ({ allowed: true, confirmation_required: false }),
      execute: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      writeArtifact: async () => {},
    })).rejects.toMatchObject({ code: 'WORKSPACE_BOOTSTRAP_FAILED' })
    await expect(runWorkspaceBootstrap({
      commands: ['bun install'],
      canonicalRoot: '.',
      context: context(paths.workspace),
      evaluatePolicy: () => ({ allowed: true, confirmation_required: false }),
      execute: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      writeArtifact: async () => {},
    })).rejects.toMatchObject({ code: 'WORKSPACE_BOOTSTRAP_FAILED' })
  })
})

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, realpath, rm } from 'fs/promises'
import { join, sep } from 'path'
import { tmpdir } from 'os'
import { createDefaultWorkspaceConfig } from '@/lib/workspaces/config-schema'
import type { SurfaceWorkspaceState } from '@/lib/workspaces/providers/provider'
import type { SurfaceWorkspace } from '@/lib/workspaces/schema'
import {
  classifyAttemptSideEffect,
  planAttemptWorkspace,
  requiresIsolatedWorkspace,
  resolveWorkspaceDispatchContext,
  WorkspacePlanningError,
} from './workspace-planner'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function roots(): Promise<{ canonical: string; workspace: string; sibling: string }> {
  const root = await mkdtemp(join(tmpdir(), 'threados-planner-'))
  temporaryRoots.push(root)
  const canonical = join(root, 'canonical')
  const workspace = join(root, 'runtime', 'workspaces', 'run-1', 'workspace-1', 'tree')
  const sibling = join(root, 'runtime', 'workspaces', 'run-1', 'workspace-2', 'tree')
  await Promise.all([
    mkdir(canonical, { recursive: true }),
    mkdir(workspace, { recursive: true }),
    mkdir(sibling, { recursive: true }),
  ])
  return {
    canonical: await realpath(canonical),
    workspace: await realpath(workspace),
    sibling: await realpath(sibling),
  }
}

function workspace(rootPath: string, overrides: Partial<SurfaceWorkspace> = {}): SurfaceWorkspace {
  return {
    schema_version: 1,
    id: 'workspace-1',
    revision: 2,
    workflow_run_id: 'run-1',
    attempt_id: 'attempt-1',
    surface_id: 'surface-1',
    snapshot_id: 'snapshot-1',
    provider: 'copy',
    isolation_label: 'THREADOS_SCOPED',
    root_path: rootPath,
    status: 'ready',
    retention_policy: 'retain_until_applied',
    manifest_hash: `sha256:${'a'.repeat(64)}`,
    file_count: 1,
    total_bytes: 4,
    reserved_bytes: 4,
    created_at: '2026-08-28T00:00:00.000Z',
    ready_at: '2026-08-28T00:01:00.000Z',
    cleaned_at: null,
    error_code: null,
    ...overrides,
  }
}

function state(rootPath: string, overrides: Partial<SurfaceWorkspaceState> = {}): SurfaceWorkspaceState {
  return {
    workspace: workspace(rootPath),
    treeExists: true,
    manifestValid: true,
    hasUsefulOutput: false,
    issue: null,
    ...overrides,
  }
}

describe('classifyAttemptSideEffect', () => {
  test('honors an explicit class, including an intentional read-only declaration', () => {
    expect(classifyAttemptSideEffect({ model: 'codex', declaredSideEffectClass: 'none' })).toBe('none')
    expect(classifyAttemptSideEffect({ model: 'shell', declaredSideEffectClass: 'read' })).toBe('read')
    expect(classifyAttemptSideEffect({ model: 'custom', declaredSideEffectClass: 'execute' })).toBe('execute')
  })

  test('classifies legacy and unknown providers conservatively when the class was omitted', () => {
    expect(classifyAttemptSideEffect({ model: 'shell' })).toBe('execute')
    expect(classifyAttemptSideEffect({ model: 'claude-code' })).toBe('write')
    expect(classifyAttemptSideEffect({ model: 'codex' })).toBe('write')
    expect(classifyAttemptSideEffect({ model: 'gemini' })).toBe('write')
    expect(classifyAttemptSideEffect({ model: 'codex', adapterReadOnly: true })).toBe('write')
    expect(classifyAttemptSideEffect({ model: 'external-agent' })).toBe('write')
    expect(classifyAttemptSideEffect({ model: 'registered-reader', adapterReadOnly: true })).toBe('read')
  })
})

describe('requiresIsolatedWorkspace', () => {
  test('is the single runtime policy for side effects and explicit isolation', () => {
    expect(requiresIsolatedWorkspace({ model: 'reader', declaredSideEffectClass: 'read' })).toBe(false)
    expect(requiresIsolatedWorkspace({ model: 'reader', declaredSideEffectClass: 'read', workspaceMode: 'isolated' })).toBe(true)
    expect(requiresIsolatedWorkspace({ model: 'codex' })).toBe(true)
    expect(requiresIsolatedWorkspace({ model: 'shell', declaredSideEffectClass: 'execute' })).toBe(true)
  })
})

describe('planAttemptWorkspace', () => {
  const base = {
    model: 'codex',
    workflowRunId: 'run-1',
    attemptId: 'attempt-1',
    surfaceId: 'surface-1',
    snapshotId: 'snapshot-1',
    config: createDefaultWorkspaceConfig(),
  }

  test('keeps none/read attempts canonical in auto mode and honors explicit isolation', () => {
    expect(planAttemptWorkspace({ ...base, declaredSideEffectClass: 'read' })).toMatchObject({
      sideEffectClass: 'read',
      executionTarget: 'canonical',
      requiresIsolation: false,
      snapshotRequest: null,
      workspaceRequest: null,
    })
    expect(planAttemptWorkspace({
      ...base,
      declaredSideEffectClass: 'read',
      workspaceMode: 'isolated',
    })).toMatchObject({
      executionTarget: 'isolated',
      requiresIsolation: true,
    })
  })

  test('requires one snapshot and one bound workspace request for write/execute attempts', () => {
    const plan = planAttemptWorkspace({ ...base, declaredSideEffectClass: 'write' })
    expect(plan).toEqual({
      sideEffectClass: 'write',
      workspaceMode: 'isolated',
      executionTarget: 'isolated',
      requiresIsolation: true,
      snapshotRequest: { action: 'create_or_reuse', workflowRunId: 'run-1' },
      workspaceRequest: {
        workflowRunId: 'run-1',
        attemptId: 'attempt-1',
        surfaceId: 'surface-1',
        snapshotId: 'snapshot-1',
        config: base.config,
        requestedIsolation: 'THREADOS_SCOPED',
      },
    })
  })
})

describe('resolveWorkspaceDispatchContext', () => {
  test('returns only the verified workspace cwd and identifier-only prompt/environment context', async () => {
    const paths = await roots()
    const context = await resolveWorkspaceDispatchContext({
      state: state(paths.workspace),
      expected: {
        workflowRunId: 'run-1',
        attemptId: 'attempt-1',
        surfaceId: 'surface-1',
        snapshotId: 'snapshot-1',
      },
      canonicalRoot: paths.canonical,
      sealedSiblingRoots: [paths.sibling],
      stepId: 'step-1',
    })

    expect(context.cwd).toBe(paths.workspace)
    expect(context.isolationLabel).toBe('THREADOS_SCOPED')
    expect(context.environment).toEqual({
      THREADOS_WORKSPACE_ID: 'workspace-1',
      THREADOS_SNAPSHOT_ID: 'snapshot-1',
      THREADOS_ATTEMPT_ID: 'attempt-1',
      THREADOS_RUN_ID: 'run-1',
      THREADOS_STEP_ID: 'step-1',
    })
    expect(JSON.stringify({ environment: context.environment, promptContext: context.promptContext }))
      .not.toContain(paths.canonical)
    expect(JSON.stringify({ environment: context.environment, promptContext: context.promptContext }))
      .not.toContain(paths.sibling)
  })

  test('rejects missing, unready, or manifest-invalid workspace evidence', async () => {
    const paths = await roots()
    const input = {
      expected: {
        workflowRunId: 'run-1', attemptId: 'attempt-1', surfaceId: 'surface-1', snapshotId: 'snapshot-1',
      },
      canonicalRoot: paths.canonical,
      stepId: 'step-1',
    }

    await expect(resolveWorkspaceDispatchContext({ ...input, state: null }))
      .rejects.toMatchObject({ code: 'WORKSPACE_MISSING' })
    await expect(resolveWorkspaceDispatchContext({
      ...input,
      state: state(paths.workspace, { workspace: workspace(paths.workspace, { status: 'planned' }) }),
    })).rejects.toMatchObject({ code: 'WORKSPACE_NOT_READY' })
    await expect(resolveWorkspaceDispatchContext({
      ...input,
      state: state(paths.workspace, { manifestValid: false }),
    })).rejects.toMatchObject({ code: 'WORKSPACE_MANIFEST_INVALID' })
  })

  test('rejects identity mismatches, missing trees, and canonical or sibling roots', async () => {
    const paths = await roots()
    const expected = {
      workflowRunId: 'run-1', attemptId: 'attempt-1', surfaceId: 'surface-1', snapshotId: 'snapshot-1',
    }
    const common = { expected, canonicalRoot: paths.canonical, stepId: 'step-1' }

    await expect(resolveWorkspaceDispatchContext({
      ...common,
      state: state(paths.workspace, { treeExists: false }),
    })).rejects.toMatchObject({ code: 'WORKSPACE_TREE_MISSING' })
    await expect(resolveWorkspaceDispatchContext({
      ...common,
      state: state(paths.workspace, {
        workspace: workspace(paths.workspace, { attempt_id: 'other-attempt' }),
      }),
    })).rejects.toMatchObject({ code: 'WORKSPACE_BINDING_MISMATCH' })
    await expect(resolveWorkspaceDispatchContext({
      ...common,
      state: state(paths.canonical, { workspace: workspace(paths.canonical) }),
    })).rejects.toBeInstanceOf(WorkspacePlanningError)
    await expect(resolveWorkspaceDispatchContext({
      ...common,
      state: state(paths.sibling, { workspace: workspace(paths.sibling) }),
      sealedSiblingRoots: [paths.sibling],
    })).rejects.toMatchObject({ code: 'WORKSPACE_ROOT_UNSAFE' })
  })

  test('rejects relative roots and lexical dot-segment aliases before realpath normalization', async () => {
    const paths = await roots()
    const expected = {
      workflowRunId: 'run-1', attemptId: 'attempt-1', surfaceId: 'surface-1', snapshotId: 'snapshot-1',
    }
    const common = { expected, canonicalRoot: paths.canonical, stepId: 'step-1' }
    const aliasedWorkspace = paths.workspace + sep + '..' + sep + 'tree'

    await expect(resolveWorkspaceDispatchContext({
      ...common,
      state: state(aliasedWorkspace, { workspace: workspace(aliasedWorkspace) }),
    })).rejects.toMatchObject({ code: 'WORKSPACE_ROOT_UNSAFE' })
    await expect(resolveWorkspaceDispatchContext({
      ...common,
      canonicalRoot: '.',
      state: state(paths.workspace),
    })).rejects.toMatchObject({ code: 'WORKSPACE_ROOT_UNSAFE' })
  })
})

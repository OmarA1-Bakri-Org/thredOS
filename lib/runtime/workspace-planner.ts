import type { WorkspaceConfig } from '@/lib/workspaces/config-schema'
import type { SurfaceWorkspaceState } from '@/lib/workspaces/providers/provider'
import type { ProvisionSurfaceWorkspaceRequest } from '@/lib/workspaces/manager'
import { realpath } from 'fs/promises'
import { isAbsolute, normalize, parse, relative, resolve } from 'path'
import {
  classifyLegacyStepSideEffect,
  type SideEffectClass,
  type WorkspaceMode,
} from '@/lib/sequence/schema'

export type AttemptSideEffectClass = SideEffectClass
export type AttemptWorkspaceMode = WorkspaceMode

export interface SideEffectClassificationInput {
  model: string
  declaredSideEffectClass?: AttemptSideEffectClass
  adapterReadOnly?: boolean
}

export interface AttemptWorkspacePlanningInput extends SideEffectClassificationInput {
  workflowRunId: string
  attemptId: string
  surfaceId: string
  snapshotId: string
  config: WorkspaceConfig
  workspaceMode?: AttemptWorkspaceMode
}

export interface WorkspaceIsolationRequirementInput extends SideEffectClassificationInput {
  workspaceMode?: AttemptWorkspaceMode
}

export interface AttemptWorkspacePlan {
  sideEffectClass: AttemptSideEffectClass
  workspaceMode: AttemptWorkspaceMode
  executionTarget: 'canonical' | 'isolated'
  requiresIsolation: boolean
  snapshotRequest: { action: 'create_or_reuse'; workflowRunId: string } | null
  workspaceRequest: ProvisionSurfaceWorkspaceRequest | null
}

export interface WorkspaceBindingExpectation {
  workflowRunId: string
  attemptId: string
  surfaceId: string
  snapshotId: string
}

export interface ResolveWorkspaceDispatchContextInput {
  state: SurfaceWorkspaceState | null
  expected: WorkspaceBindingExpectation
  canonicalRoot: string
  sealedSiblingRoots?: string[]
  stepId: string
}

export interface WorkspaceDispatchContext {
  cwd: string
  workspaceId: string
  snapshotId: string
  attemptId: string
  workflowRunId: string
  isolationLabel: 'THREADOS_SCOPED'
  environment: Record<string, string>
  promptContext: {
    workspace_id: string
    snapshot_id: string
    isolation_label: 'THREADOS_SCOPED'
    instruction: string
  }
}

export type WorkspacePlanningErrorCode =
  | 'WORKSPACE_MISSING'
  | 'WORKSPACE_NOT_READY'
  | 'WORKSPACE_TREE_MISSING'
  | 'WORKSPACE_MANIFEST_INVALID'
  | 'WORKSPACE_BINDING_MISMATCH'
  | 'WORKSPACE_ROOT_UNSAFE'

export class WorkspacePlanningError extends Error {
  constructor(public readonly code: WorkspacePlanningErrorCode, message: string) {
    super(message)
    this.name = 'WorkspacePlanningError'
  }
}

export function classifyAttemptSideEffect(_input: SideEffectClassificationInput): AttemptSideEffectClass {
  if (_input.declaredSideEffectClass !== undefined) return _input.declaredSideEffectClass
  if (['shell', 'claude-code', 'codex', 'gemini'].includes(_input.model)) {
    return classifyLegacyStepSideEffect(_input.model)
  }
  if (_input.adapterReadOnly === true) return 'read'
  return classifyLegacyStepSideEffect(_input.model)
}

export function requiresIsolatedWorkspace(input: WorkspaceIsolationRequirementInput): boolean {
  const sideEffectClass = classifyAttemptSideEffect(input)
  return input.workspaceMode === 'isolated'
    || sideEffectClass === 'write'
    || sideEffectClass === 'execute'
}

export function planAttemptWorkspace(_input: AttemptWorkspacePlanningInput): AttemptWorkspacePlan {
  const sideEffectClass = classifyAttemptSideEffect(_input)
  const requiresIsolation = requiresIsolatedWorkspace(_input)

  if (!requiresIsolation) {
    return {
      sideEffectClass,
      workspaceMode: 'auto',
      executionTarget: 'canonical',
      requiresIsolation: false,
      snapshotRequest: null,
      workspaceRequest: null,
    }
  }

  return {
    sideEffectClass,
    workspaceMode: 'isolated',
    executionTarget: 'isolated',
    requiresIsolation: true,
    snapshotRequest: { action: 'create_or_reuse', workflowRunId: _input.workflowRunId },
    workspaceRequest: {
      workflowRunId: _input.workflowRunId,
      attemptId: _input.attemptId,
      surfaceId: _input.surfaceId,
      snapshotId: _input.snapshotId,
      config: _input.config,
      requestedIsolation: 'THREADOS_SCOPED',
    },
  }
}

function pathIdentity(path: string): string {
  const normalized = resolve(path)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function sameOrWithin(parent: string, candidate: string): boolean {
  const parentIdentity = pathIdentity(parent)
  const candidateIdentity = pathIdentity(candidate)
  const child = relative(parentIdentity, candidateIdentity)
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}

function lexicalPathIdentity(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

function assertLexicallySafeAbsolutePath(path: string, label: string): string {
  if (!isAbsolute(path)) {
    throw new WorkspacePlanningError('WORKSPACE_ROOT_UNSAFE', label + ' must be absolute')
  }
  const root = parse(path).root
  const remainder = path.slice(root.length)
  const segments = remainder.split(process.platform === 'win32' ? /[\\/]/ : /\//)
  if (segments.some(segment => segment === '.' || segment === '..')) {
    throw new WorkspacePlanningError(
      'WORKSPACE_ROOT_UNSAFE',
      label + ' must not contain dot segments',
    )
  }
  const normalized = normalize(path)
  if (lexicalPathIdentity(path) !== lexicalPathIdentity(normalized)) {
    throw new WorkspacePlanningError(
      'WORKSPACE_ROOT_UNSAFE',
      label + ' must be an exact normalized platform path',
    )
  }
  return path
}

async function resolveVerifiedRoot(path: string, label: string): Promise<string> {
  try {
    const lexical = assertLexicallySafeAbsolutePath(path, label)
    const canonical = await realpath(lexical)
    if (lexicalPathIdentity(lexical) !== lexicalPathIdentity(canonical)) {
      throw new WorkspacePlanningError(
        'WORKSPACE_ROOT_UNSAFE',
        `${label} resolves through an alias or symbolic link`,
      )
    }
    return canonical
  } catch (error) {
    if (error instanceof WorkspacePlanningError) throw error
    throw new WorkspacePlanningError(
      'WORKSPACE_ROOT_UNSAFE',
      `${label} could not be resolved safely`,
    )
  }
}

function requireReadyWorkspace(input: ResolveWorkspaceDispatchContextInput): SurfaceWorkspaceState['workspace'] {
  if (input.state == null) {
    throw new WorkspacePlanningError('WORKSPACE_MISSING', 'An isolated attempt requires a workspace record')
  }
  const { workspace } = input.state
  if (workspace.status !== 'ready' || workspace.ready_at == null || workspace.manifest_hash == null) {
    throw new WorkspacePlanningError('WORKSPACE_NOT_READY', `Workspace ${workspace.id} is not ready for dispatch`)
  }
  if (!input.state.treeExists) {
    throw new WorkspacePlanningError('WORKSPACE_TREE_MISSING', `Workspace ${workspace.id} has no verified tree`)
  }
  if (input.state.manifestValid !== true) {
    throw new WorkspacePlanningError('WORKSPACE_MANIFEST_INVALID', `Workspace ${workspace.id} does not have a valid manifest`)
  }
  return workspace
}

function assertWorkspaceBinding(
  workspace: SurfaceWorkspaceState['workspace'],
  expected: WorkspaceBindingExpectation,
): void {
  if (workspace.isolation_label !== 'THREADOS_SCOPED') {
    throw new WorkspacePlanningError('WORKSPACE_NOT_READY', `Workspace ${workspace.id} does not provide the required isolation contract`)
  }
  if (workspace.workflow_run_id !== expected.workflowRunId
    || workspace.attempt_id !== expected.attemptId
    || workspace.surface_id !== expected.surfaceId
    || workspace.snapshot_id !== expected.snapshotId) {
    throw new WorkspacePlanningError('WORKSPACE_BINDING_MISMATCH', `Workspace ${workspace.id} is not bound to the requested attempt`)
  }
}

async function verifyWorkspaceRoot(
  workspace: SurfaceWorkspaceState['workspace'],
  input: ResolveWorkspaceDispatchContextInput,
): Promise<string> {
  const workspaceRoot = await resolveVerifiedRoot(workspace.root_path, 'workspace root')
  const canonicalRoot = await resolveVerifiedRoot(input.canonicalRoot, 'canonical root')
  if (sameOrWithin(canonicalRoot, workspaceRoot) || sameOrWithin(workspaceRoot, canonicalRoot)) {
    throw new WorkspacePlanningError(
      'WORKSPACE_ROOT_UNSAFE',
      'The isolated workspace must not overlap the canonical project',
    )
  }
  for (const sibling of input.sealedSiblingRoots ?? []) {
    const siblingRoot = await resolveVerifiedRoot(sibling, 'sealed sibling workspace root')
    if (sameOrWithin(siblingRoot, workspaceRoot) || sameOrWithin(workspaceRoot, siblingRoot)) {
      throw new WorkspacePlanningError(
        'WORKSPACE_ROOT_UNSAFE',
        'The selected workspace overlaps a sealed sibling workspace',
      )
    }
  }
  return workspaceRoot
}

export async function resolveWorkspaceDispatchContext(
  input: ResolveWorkspaceDispatchContextInput,
): Promise<WorkspaceDispatchContext> {
  const workspace = requireReadyWorkspace(input)
  assertWorkspaceBinding(workspace, input.expected)
  const workspaceRoot = await verifyWorkspaceRoot(workspace, input)
  return {
    cwd: workspaceRoot,
    workspaceId: workspace.id,
    snapshotId: workspace.snapshot_id,
    attemptId: workspace.attempt_id,
    workflowRunId: workspace.workflow_run_id,
    isolationLabel: 'THREADOS_SCOPED',
    environment: {
      THREADOS_WORKSPACE_ID: workspace.id,
      THREADOS_SNAPSHOT_ID: workspace.snapshot_id,
      THREADOS_ATTEMPT_ID: workspace.attempt_id,
      THREADOS_RUN_ID: workspace.workflow_run_id,
      THREADOS_STEP_ID: input.stepId,
    },
    promptContext: {
      workspace_id: workspace.id,
      snapshot_id: workspace.snapshot_id,
      isolation_label: 'THREADOS_SCOPED',
      instruction: 'Operate only in the provided working directory.',
    },
  }
}

import { randomUUID } from 'crypto'
import { readdir, realpath } from 'fs/promises'
import { resolve } from 'path'
import { z } from 'zod'
import { readLocalWorkspace } from '../local-first/workspace'
import { PolicyEngine } from '../policy/engine'
import { assertSafePathSegment, resolveExistingPathWithinRoot } from '../security/safe-path'
import { readTextFileNoFollow } from '../security/safe-io'
import { withExclusiveFileLock } from '../fs/atomic'
import { SurfaceWorkspaceManager } from '../workspaces/manager'
import { WorkspaceRepository } from '../workspaces/repository'
import { SnapshotRepository } from '../workspaces/snapshot-repository'
import { doctorWorkspaces, type WorkspaceDoctorReport } from '../workspaces/doctor'
import { copyWorkspaceTreePath } from '../workspaces/providers/copy'
import type { WorkspaceInspection } from '../workspaces/inspection'
import type { SurfaceWorkspace, SurfaceWorkspaceStatus } from '../workspaces/schema'
import { AttemptRepository } from './attempt-repository'
import { ProcessRepository } from './process-repository'
import { CommandRepository } from './command-repository'
import { RuntimeCommandContextSchema, type RuntimeCommandContext } from './command-schema'
import { stableRuntimeHash } from './attempt-executor'
import { RuntimeServiceError } from './errors'
import { RuntimeRepositoryError } from './run-repository'
import type { StepAttemptStatus } from './schema'
import { assertWorkspaceProcessTermination } from './workspace-process-evidence'
import { commandIdempotencyLockPath } from './paths'
import { idempotencyDigest } from './runtime-index'

const BootstrapSchema = z.object({
  workspace_id: z.string(),
  attempt_id: z.string(),
  index: z.number().int().nonnegative(),
  status: z.enum(['success', 'failed', 'policy_blocked', 'error']),
  duration_ms: z.number().nonnegative(),
  exit_code: z.number().int().nullable(),
})

const terminalAttempts = new Set<StepAttemptStatus>([
  'completed',
  'needs_review',
  'failed',
  'cancelled',
  'timed_out',
  'interrupted',
])
const unavailableWorkspaceStatuses = new Set<SurfaceWorkspaceStatus>([
  'planned',
  'materializing',
  'active',
  'cleaning',
])

type WorkspaceMutation = 'retain' | 'clean'

interface InFlightWorkspaceMutation {
  requestHash: string
  promise: Promise<WorkspaceInspection>
}

function safeId(id: string): string {
  try {
    return assertSafePathSegment(id, 'workspace identifier')
  } catch {
    throw new RuntimeServiceError('VALIDATION_ERROR', 'Invalid workspace identifier')
  }
}

function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function samePath(left: string, right: string): boolean {
  const resolvedLeft = resolve(left)
  const resolvedRight = resolve(right)
  return process.platform === 'win32'
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight
}

export class WorkspaceOperations {
  private readonly inFlight = new Map<string, InFlightWorkspaceMutation>()

  constructor(private readonly basePath: string) {}

  async list(query: { runId?: string } = {}): Promise<SurfaceWorkspace[]> {
    if (query.runId !== undefined) safeId(query.runId)
    return (await new WorkspaceRepository(this.basePath).list())
      .filter(workspace => !query.runId || workspace.workflow_run_id === query.runId)
  }

  private async resources(actor = 'workspace-operator') {
    const local = await readLocalWorkspace(this.basePath)
    return {
      local,
      manager: new SurfaceWorkspaceManager({
        canonicalRoot: this.basePath,
        runtimeDataRoot: local.runtimeDataRoot,
        localWorkspaceId: local.id,
        actor,
      }),
    }
  }

  async inspect(id: string): Promise<WorkspaceInspection> {
    safeId(id)
    const workspace = await new WorkspaceRepository(this.basePath).get(id)
    if (!workspace) {
      throw new RuntimeServiceError('WORKSPACE_NOT_FOUND', 'Workspace was not found')
    }
    const { local, manager } = await this.resources()
    const diagnostics: WorkspaceInspection['diagnostics'] = []
    let verification: WorkspaceInspection['verification'] = {
      exists: false,
      manifestMatches: null,
      hasUsefulOutput: null,
    }
    const expected = copyWorkspaceTreePath(local.surfaceWorkspaceRoot, workspace.workflow_run_id, id)
    try {
      if (!samePath(expected, workspace.root_path)) throw new Error('unsafe')
      if (workspace.status !== 'cleaned') {
        const actual = await realpath(workspace.root_path)
        if (!samePath(actual, expected)) throw new Error('unsafe')
        const state = await manager.inspect(id)
        verification = {
          exists: state.treeExists,
          manifestMatches: state.manifestValid,
          hasUsefulOutput: state.hasUsefulOutput,
        }
        if (!state.treeExists) {
          diagnostics.push({
            code: 'WORKSPACE_TREE_MISSING',
            message: 'Workspace tree is missing',
          })
        }
      }
    } catch (error) {
      diagnostics.push({
        code: missing(error) ? 'WORKSPACE_TREE_MISSING' : 'WORKSPACE_STORAGE_UNSAFE',
        message: 'Workspace storage could not be verified',
      })
    }
    const snapshots = new SnapshotRepository(this.basePath)
    const snapshot = await snapshots.get(workspace.snapshot_id)
    const manifest = await snapshots.getManifest(workspace.snapshot_id)
    if (
      !snapshot
      || !manifest
      || snapshot.root_manifest_hash !== workspace.manifest_hash
      || manifest.root_manifest_hash !== workspace.manifest_hash
    ) {
      diagnostics.push({
        code: 'WORKSPACE_MANIFEST_INVALID',
        message: 'Snapshot binding could not be verified',
      })
    }
    const attempt = await new AttemptRepository(this.basePath).get(workspace.attempt_id)
    const processes = (await new ProcessRepository(this.basePath).list()).filter(item => item.attempt_id === workspace.attempt_id && item.workflow_run_id === workspace.workflow_run_id)
    const bootstrap: WorkspaceInspection['bootstrap'] = []
    try {
      const root = await resolveExistingPathWithinRoot(this.basePath, '.threados', 'runs', workspace.workflow_run_id, 'attempts', workspace.attempt_id)
      for (const name of (await readdir(root)).filter(name => /^bootstrap-\d+\.json$/.test(name)).slice(0, 1000)) {
        const path = await resolveExistingPathWithinRoot(root, name)
        const artifact = BootstrapSchema.parse(JSON.parse(await readTextFileNoFollow(path)))
        if (artifact.workspace_id !== id || artifact.attempt_id !== workspace.attempt_id) throw new Error('binding')
        const { index, status, duration_ms, exit_code } = artifact
        bootstrap.push({ index, status, duration_ms, exit_code })
      }
    } catch (error) {
      if (!missing(error)) {
        diagnostics.push({
          code: 'WORKSPACE_BOOTSTRAP_FAILED',
          message: 'Bootstrap evidence could not be verified',
        })
      }
    }
    return {
      schema_version: 1,
      workspace,
      manifest_hash: manifest?.root_manifest_hash ?? null,
      snapshot: snapshot ? {
        id: snapshot.id,
        status: snapshot.status,
        root_manifest_hash: snapshot.root_manifest_hash,
        file_count: snapshot.file_count,
        total_bytes: snapshot.total_bytes,
        created_at: snapshot.created_at,
        verified_at: snapshot.verified_at,
      } : null,
      attempt: attempt ? {
        id: attempt.id,
        status: attempt.status,
        step_id: attempt.step_id,
        workflow_run_id: attempt.workflow_run_id,
      } : null,
      processes: processes.map(({
        id: processId,
        attempt_id,
        status,
        pid,
        exit_code,
        started_at,
        ended_at,
      }) => ({
        id: processId,
        attempt_id,
        status,
        pid,
        exit_code,
        started_at,
        ended_at,
      })),
      verification,
      bootstrap: bootstrap.sort((left, right) => left.index - right.index),
      diagnostics,
    }
  }

  async doctor(): Promise<WorkspaceDoctorReport> {
    const { local } = await this.resources()
    try {
      const report = await doctorWorkspaces({
        repository: new WorkspaceRepository(this.basePath),
        snapshotRepository: new SnapshotRepository(this.basePath),
        workspacesRoot: local.surfaceWorkspaceRoot,
      })
      return {
        ...report,
        issues: report.issues.map(issue => ({
          ...issue,
          path: null,
          message: issue.code.replaceAll('_', ' ').toLowerCase(),
        })),
      }
    } catch {
      return {
        healthy: false,
        checkedRecords: 0,
        checkedDirectories: 0,
        issues: [{
          code: 'WORKSPACE_STORAGE_UNSAFE',
          workspaceId: null,
          path: null,
          message: 'Workspace storage inspection failed',
        }],
      }
    }
  }

  async mutate(
    action: WorkspaceMutation,
    id: string,
    rawContext: RuntimeCommandContext,
  ): Promise<WorkspaceInspection> {
    safeId(id)
    const context = RuntimeCommandContextSchema.parse(rawContext)
    const requestHash = stableRuntimeHash({
      action,
      id,
      actor: context.actor,
      interface: context.interface,
      confirmed: context.policyConfirmed,
    })
    const existing = this.inFlight.get(context.idempotencyKey)
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new RuntimeRepositoryError(
          'IDEMPOTENCY_CONFLICT',
          'idempotency key was already used for a different request payload',
        )
      }
      return await existing.promise
    }

    const promise = this.executeMutation(action, id, context, requestHash)
    this.inFlight.set(context.idempotencyKey, { requestHash, promise })
    try {
      return await promise
    } finally {
      const current = this.inFlight.get(context.idempotencyKey)
      if (current?.promise === promise) this.inFlight.delete(context.idempotencyKey)
    }
  }

  private async executeMutation(
    action: WorkspaceMutation,
    id: string,
    context: RuntimeCommandContext,
    requestHash: string,
  ): Promise<WorkspaceInspection> {
    const commands = new CommandRepository(this.basePath)
    const commandId = `command-${randomUUID()}`
    const receipt = await commands.createOrReplay({
      schema_version: 1,
      id: commandId,
      idempotency_key: context.idempotencyKey,
      command_type: `${action}-workspace`,
      request_hash: requestHash,
      status: 'accepted',
      result_ref: id,
      error_code: null,
      error_message: null,
      created_at: new Date().toISOString(),
      completed_at: null,
    })
    if (receipt.id !== commandId) {
      if (receipt.status === 'completed') return this.inspect(id)
      if (receipt.status === 'failed') {
        throw new RuntimeRepositoryError(
          receipt.error_code ?? 'WORKSPACE_NOT_CLEANABLE',
          receipt.error_message ?? 'Workspace operation failed',
        )
      }
    }
    const lockPath = await commandIdempotencyLockPath(
      this.basePath,
      idempotencyDigest(context.idempotencyKey),
    )
    try {
      return await withExclusiveFileLock(lockPath, async () => {
        const current = await commands.get(receipt.id)
        if (!current) {
          throw new RuntimeServiceError(
            'RUNTIME_REVISION_CONFLICT',
            'Workspace operation receipt is unavailable',
          )
        }
        if (current.status === 'completed') return await this.inspect(id)
        if (current.status === 'failed') {
          throw new RuntimeRepositoryError(
            current.error_code ?? 'WORKSPACE_NOT_CLEANABLE',
            current.error_message ?? 'Workspace operation failed',
          )
        }
        return await this.executeClaimedMutation(action, id, context, commands, receipt.id)
      }, { allowedRoot: this.basePath, timeoutMs: 30_000, staleAfterMs: 60_000 })
    } catch (error) {
      if (error instanceof RuntimeServiceError || error instanceof RuntimeRepositoryError) throw error
      throw new RuntimeServiceError(
        'RUNTIME_REVISION_CONFLICT',
        'Workspace operation is already in progress; inspect before retrying',
        error,
      )
    }
  }

  private async executeClaimedMutation(
    action: WorkspaceMutation,
    id: string,
    context: RuntimeCommandContext,
    commands: CommandRepository,
    commandId: string,
  ): Promise<WorkspaceInspection> {
    try {
      const projection = await this.inspect(id)
      if (
        action === 'clean'
        && (await PolicyEngine.load(this.basePath)).getConfig().mode === 'SAFE'
        && !context.policyConfirmed
      ) {
        throw new RuntimeServiceError(
          'POLICY_CONFIRMATION_REQUIRED',
          'Cleaning requires explicit confirmation in SAFE mode',
        )
      }
      if (
        unavailableWorkspaceStatuses.has(projection.workspace.status)
        || projection.attempt && !terminalAttempts.has(projection.attempt.status)
      ) {
        throw new RuntimeServiceError(
          'WORKSPACE_NOT_CLEANABLE',
          'Workspace is associated with active or provisioning work',
        )
      }
      await assertWorkspaceProcessTermination(this.basePath, projection.workspace)
      if (action === 'retain' && projection.workspace.status === 'cleaned') {
        throw new RuntimeServiceError(
          'WORKSPACE_NOT_CLEANABLE',
          'Cleaned workspace content cannot be retained',
        )
      }
      if (
        (action === 'retain' && projection.workspace.status === 'retained')
        || (action === 'clean' && projection.workspace.status === 'cleaned')
      ) {
        await commands.complete(commandId, { status: 'completed', resultRef: id })
        return projection
      }
      const { manager } = await this.resources(context.actor)
      if (action === 'clean') await manager.destroy(id)
      else await manager.finalize(id, { outcome: 'needs_review' })
      await commands.complete(commandId, { status: 'completed', resultRef: id })
      return await this.inspect(id)
    } catch (error) {
      const safe = error instanceof RuntimeServiceError || error instanceof RuntimeRepositoryError
        ? error
        : new RuntimeServiceError(
          'WORKSPACE_NOT_CLEANABLE',
          'Workspace operation failed; inspect retained evidence before retrying',
          error,
        )
      await commands.complete(commandId, {
        status: 'failed',
        errorCode: safe.code,
        errorMessage: safe.message,
      })
      throw safe
    }
  }
}

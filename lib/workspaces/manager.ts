import { randomUUID } from 'crypto'
import { realpath } from 'fs/promises'
import { appendTraceEvent } from '@/lib/traces/writer'
import { assertSafePathSegment } from '@/lib/security/safe-path'
import type { WorkspaceConfig } from './config-schema'
import { resolveRuntimeDataRoot, resolveWorkspaceRuntimePaths, type WorkspaceRuntimePaths } from './paths'
import { CopyWorkspaceProvider, copyWorkspaceTreePath } from './providers/copy'
import type { SurfaceWorkspaceState } from './providers/provider'
import { assertProvisionQuota } from './quotas'
import { WorkspaceRepository } from './repository'
import {
  decideWorkspaceRetention,
  type WorkspaceRetentionContext,
  type WorkspaceRetentionDecision,
} from './retention'
import { SnapshotRepository } from './snapshot-repository'
import { SurfaceWorkspaceSchema, type SurfaceWorkspace } from './schema'
import { verifySnapshotManifest } from './manifest'

export interface SurfaceWorkspaceManagerOptions {
  canonicalRoot: string
  runtimeDataRoot: string
  localWorkspaceId: string
  repository?: WorkspaceRepository
  snapshotRepository?: SnapshotRepository
  now?: () => Date
  createId?: () => string
  appendTrace?: typeof appendTraceEvent
  actor?: string
}

export interface ProvisionSurfaceWorkspaceRequest {
  workflowRunId: string
  attemptId: string
  surfaceId: string
  snapshotId: string
  config: WorkspaceConfig
  requestedIsolation?: SurfaceWorkspace['isolation_label']
}

export interface FinalizeWorkspaceResult {
  workspace: SurfaceWorkspace
  decision: WorkspaceRetentionDecision
}

export type SurfaceWorkspaceManagerErrorCode =
  | 'SNAPSHOT_NOT_FOUND'
  | 'SNAPSHOT_NOT_READY'
  | 'WORKSPACE_PROVIDER_UNAVAILABLE'
  | 'WORKSPACE_INVALID_STATE'
  | 'WORKSPACE_TRACE_PERSIST_FAILED'

export class SurfaceWorkspaceManagerError extends Error {
  constructor(
    public readonly code: SurfaceWorkspaceManagerErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'SurfaceWorkspaceManagerError'
  }
}

export class SurfaceWorkspaceTraceError extends SurfaceWorkspaceManagerError {
  readonly commit_status = 'committed' as const

  constructor(
    public readonly workspace: SurfaceWorkspace,
    public readonly eventType:
      | 'workspace-provision-started'
      | 'workspace-ready'
      | 'workspace-retained'
      | 'workspace-cleaned',
    public readonly cause: unknown,
  ) {
    super(
      'WORKSPACE_TRACE_PERSIST_FAILED',
      `workspace ${workspace.id} committed ${eventType}, but trace persistence failed`,
    )
    this.name = 'SurfaceWorkspaceTraceError'
  }
}

export class SurfaceWorkspaceManager {
  private readonly repository: WorkspaceRepository
  private readonly snapshots: SnapshotRepository
  private readonly now: () => Date
  private readonly createId: () => string
  private readonly traceAppender: typeof appendTraceEvent
  private pathsPromise: Promise<WorkspaceRuntimePaths> | null = null
  private providerPromise: Promise<CopyWorkspaceProvider> | null = null

  constructor(private readonly options: SurfaceWorkspaceManagerOptions) {
    this.repository = options.repository ?? new WorkspaceRepository(options.canonicalRoot)
    this.snapshots = options.snapshotRepository ?? new SnapshotRepository(options.canonicalRoot)
    this.now = options.now ?? (() => new Date())
    this.createId = options.createId ?? randomUUID
    this.traceAppender = options.appendTrace ?? appendTraceEvent
  }

  private async appendTrace(
    workspace: SurfaceWorkspace,
    eventType:
      | 'workspace-provision-started'
      | 'workspace-ready'
      | 'workspace-retained'
      | 'workspace-cleaned',
  ): Promise<void> {
    try {
      await this.traceAppender(this.options.canonicalRoot, workspace.workflow_run_id, {
        ts: this.now().toISOString(),
        run_id: workspace.workflow_run_id,
        surface_id: workspace.surface_id,
        actor: this.options.actor ?? 'threados-runtime',
        event_type: eventType,
        payload_ref: `.threados/workspaces/records/${workspace.id}.json`,
        policy_ref: null,
      })
    } catch (error) {
      throw new SurfaceWorkspaceTraceError(workspace, eventType, error)
    }
  }

  private runtimePaths(): Promise<WorkspaceRuntimePaths> {
    this.pathsPromise ??= (async () => {
      const canonicalRoot = await realpath(this.options.canonicalRoot)
      const runtimeDataRoot = await resolveRuntimeDataRoot({
        canonicalRoot,
        override: this.options.runtimeDataRoot,
      })
      return resolveWorkspaceRuntimePaths(
        runtimeDataRoot,
        this.options.localWorkspaceId,
        canonicalRoot,
      )
    })()
    return this.pathsPromise
  }

  private provider(): Promise<CopyWorkspaceProvider> {
    this.providerPromise ??= (async () => new CopyWorkspaceProvider({
      repository: this.repository,
      snapshotRepository: this.snapshots,
      workspacesRoot: (await this.runtimePaths()).workspacesRoot,
      snapshotsRoot: (await this.runtimePaths()).snapshotsRoot,
      now: this.now,
    }))()
    return this.providerPromise
  }

  async provision(request: ProvisionSurfaceWorkspaceRequest): Promise<SurfaceWorkspace> {
    if (
      request.requestedIsolation === 'HOST_ENFORCED'
      || request.config.provider === 'container'
      || request.config.provider === 'overlayfs'
    ) {
      throw new SurfaceWorkspaceManagerError(
        'WORKSPACE_PROVIDER_UNAVAILABLE',
        'No verified provider satisfies the requested host-enforced workspace isolation',
      )
    }

    const snapshot = await this.snapshots.get(request.snapshotId)
    const manifest = await this.snapshots.getManifest(request.snapshotId)
    if (!snapshot || !manifest) {
      throw new SurfaceWorkspaceManagerError('SNAPSHOT_NOT_FOUND', `snapshot ${request.snapshotId} was not found`)
    }
    if (
      snapshot.status !== 'ready'
      || snapshot.local_workspace_id !== this.options.localWorkspaceId
      || snapshot.root_manifest_hash !== manifest.root_manifest_hash
    ) {
      throw new SurfaceWorkspaceManagerError(
        'SNAPSHOT_NOT_READY',
        `snapshot ${request.snapshotId} is not a verified baseline for this workspace`,
      )
    }

    const id = assertSafePathSegment(`workspace-${this.createId()}`, 'workspace id')
    const paths = await this.runtimePaths()
    const snapshotMetrics = verifySnapshotManifest(manifest)
    const planned = SurfaceWorkspaceSchema.parse({
      schema_version: 1,
      id,
      revision: 0,
      workflow_run_id: assertSafePathSegment(request.workflowRunId, 'workflow run id'),
      attempt_id: assertSafePathSegment(request.attemptId, 'attempt id'),
      surface_id: assertSafePathSegment(request.surfaceId, 'surface id'),
      snapshot_id: snapshot.id,
      provider: 'copy',
      isolation_label: 'THREADOS_SCOPED',
      root_path: copyWorkspaceTreePath(paths.workspacesRoot, request.workflowRunId, id),
      status: 'planned',
      retention_policy: request.config.workspace.retention,
      manifest_hash: null,
      file_count: 0,
      total_bytes: 0,
      reserved_bytes: snapshotMetrics.totalBytes,
      created_at: this.now().toISOString(),
      ready_at: null,
      cleaned_at: null,
      error_code: null,
    })
    await this.repository.create(planned, current => {
      assertProvisionQuota(current, manifest, request.config.workspace)
    })
    let startTraceFailure: SurfaceWorkspaceTraceError | null = null
    try {
      await this.appendTrace(planned, 'workspace-provision-started')
    } catch (error) {
      if (!(error instanceof SurfaceWorkspaceTraceError)) throw error
      startTraceFailure = error
    }
    const ready = await (await this.provider()).provision({
      workspaceId: planned.id,
      snapshot,
      manifest,
      limits: request.config.workspace,
    })
    await this.appendTrace(ready, 'workspace-ready')
    if (startTraceFailure) {
      throw new SurfaceWorkspaceTraceError(
        ready,
        'workspace-provision-started',
        startTraceFailure.cause,
      )
    }
    return ready
  }

  async list(): Promise<SurfaceWorkspace[]> {
    return this.repository.list()
  }

  async get(workspaceId: string): Promise<SurfaceWorkspace | null> {
    return this.repository.get(workspaceId)
  }

  async inspect(workspaceId: string): Promise<SurfaceWorkspaceState> {
    return (await this.provider()).inspect(workspaceId)
  }

  async freeze(workspaceId: string): Promise<SurfaceWorkspace> {
    return (await this.provider()).freeze(workspaceId)
  }

  async destroy(workspaceId: string): Promise<void> {
    const before = await this.repository.get(workspaceId)
    await (await this.provider()).destroy(workspaceId)
    const after = await this.repository.get(workspaceId)
    if (before?.status !== 'cleaned' && after?.status === 'cleaned') {
      await this.appendTrace(after, 'workspace-cleaned')
    }
  }

  async finalize(
    workspaceId: string,
    context: WorkspaceRetentionContext,
  ): Promise<FinalizeWorkspaceResult> {
    let workspace = await this.repository.get(workspaceId)
    if (!workspace) {
      throw new SurfaceWorkspaceManagerError('WORKSPACE_INVALID_STATE', `workspace ${workspaceId} was not found`)
    }
    const wasRetained = workspace.status === 'retained'

    let effectiveContext = context
    if (context.outcome === 'cancelled_before_write' && context.hasUsefulOutput == null) {
      const inspected = await this.inspect(workspaceId)
      effectiveContext = { ...context, hasUsefulOutput: inspected.hasUsefulOutput ?? true }
    }
    const decision = decideWorkspaceRetention(workspace.retention_policy, effectiveContext)

    if (decision.action === 'cleanup') {
      if (workspace.status === 'ready' || workspace.status === 'active') {
        workspace = await this.freeze(workspace.id)
      }
      await this.destroy(workspaceId)
      workspace = await this.repository.get(workspaceId) ?? workspace
      return { workspace, decision }
    }

    if (workspace.status === 'ready' || workspace.status === 'active') {
      workspace = await this.freeze(workspace.id)
    }
    if (workspace.status === 'frozen') {
      workspace = await this.repository.update(workspace.id, workspace.revision, current => ({
        ...current,
        status: 'retained',
        reserved_bytes: 0,
      }))
    } else if (!['retained', 'failed', 'cleaned'].includes(workspace.status)) {
      throw new SurfaceWorkspaceManagerError(
        'WORKSPACE_INVALID_STATE',
        `workspace ${workspace.id} cannot be retained from ${workspace.status}`,
      )
    }
    if (!wasRetained && workspace.status === 'retained') {
      await this.appendTrace(workspace, 'workspace-retained')
    }
    return { workspace, decision }
  }
}

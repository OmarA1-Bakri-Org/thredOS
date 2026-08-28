import type { WorkspaceLimits } from './config-schema'
import { verifySnapshotManifest } from './manifest'
import type { SnapshotManifest, SurfaceWorkspace } from './schema'

export type WorkspaceUsage = {
  activeWorkspaces: number
  retainedBytes: number
}

const ACTIVE_STATUSES = new Set<SurfaceWorkspace['status']>([
  'planned',
  'materializing',
  'ready',
  'active',
])
const RETAINED_STATUSES = new Set<SurfaceWorkspace['status']>([
  'ready',
  'active',
  'frozen',
  'retained',
  'cleaning',
  'failed',
])

export class WorkspaceQuotaError extends Error {
  readonly code = 'WORKSPACE_QUOTA_EXCEEDED'

  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceQuotaError'
  }
}

function addSafeInteger(left: number, right: number, label: string): number {
  const next = left + right
  if (!Number.isSafeInteger(next)) {
    throw new WorkspaceQuotaError(`${label} exceeds Number.MAX_SAFE_INTEGER`)
  }
  return next
}

export function calculateWorkspaceUsage(records: readonly SurfaceWorkspace[]): WorkspaceUsage {
  let activeWorkspaces = 0
  let retainedBytes = 0

  for (const record of records) {
    if (ACTIVE_STATUSES.has(record.status)) {
      activeWorkspaces = addSafeInteger(activeWorkspaces, 1, 'Workspace active count')
    }
    const reservedBytes = record.reserved_bytes ?? 0
    if (reservedBytes > 0) {
      retainedBytes = addSafeInteger(retainedBytes, reservedBytes, 'Workspace retained bytes')
    } else if (RETAINED_STATUSES.has(record.status)) {
      retainedBytes = addSafeInteger(retainedBytes, record.total_bytes, 'Workspace retained bytes')
    }
  }

  return { activeWorkspaces, retainedBytes }
}

export function assertProvisionQuota(
  records: readonly SurfaceWorkspace[],
  manifest: SnapshotManifest,
  limits: WorkspaceLimits,
  options: { excludeWorkspaceId?: string } = {},
): void {
  const verification = verifySnapshotManifest(manifest)
  const fileCount = verification.fileCount
  const usage = calculateWorkspaceUsage(
    options.excludeWorkspaceId
      ? records.filter(record => record.id !== options.excludeWorkspaceId)
      : records,
  )

  if (usage.activeWorkspaces >= limits.max_active) {
    throw new WorkspaceQuotaError(
      `Workspace active count ${usage.activeWorkspaces} reached configured maximum ${limits.max_active}`,
    )
  }
  if (fileCount > limits.max_files) {
    throw new WorkspaceQuotaError(
      `Workspace file count ${fileCount} exceeds configured maximum ${limits.max_files}`,
    )
  }
  if (verification.totalBytes > limits.max_bytes_each) {
    throw new WorkspaceQuotaError(
      `Workspace bytes ${verification.totalBytes} exceed configured maximum ${limits.max_bytes_each}`,
    )
  }
  const projectedRetained = addSafeInteger(
    usage.retainedBytes,
    verification.totalBytes,
    'Workspace retained bytes',
  )
  if (projectedRetained > limits.max_total_retained_bytes) {
    throw new WorkspaceQuotaError(
      `Workspace retained bytes ${projectedRetained} exceed configured maximum ${limits.max_total_retained_bytes}`,
    )
  }
}

export class WorkspaceQuotaTracker {
  private entries = 0
  private bytes = 0

  constructor(private readonly limits: WorkspaceLimits) {}

  recordEntry(sizeBytes: number, countsAsFile = true): void {
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
      throw new WorkspaceQuotaError('Workspace entry bytes must be a nonnegative safe integer')
    }
    const nextEntries = countsAsFile
      ? addSafeInteger(this.entries, 1, 'Workspace file count')
      : this.entries
    const nextBytes = addSafeInteger(this.bytes, sizeBytes, 'Workspace bytes')
    if (nextEntries > this.limits.max_files) {
      throw new WorkspaceQuotaError(
        `Workspace file count ${nextEntries} exceeds configured maximum ${this.limits.max_files}`,
      )
    }
    if (nextBytes > this.limits.max_bytes_each) {
      throw new WorkspaceQuotaError(
        `Workspace bytes ${nextBytes} exceed configured maximum ${this.limits.max_bytes_each}`,
      )
    }
    this.entries = nextEntries
    this.bytes = nextBytes
  }

  usage(): { entries: number; bytes: number } {
    return { entries: this.entries, bytes: this.bytes }
  }
}

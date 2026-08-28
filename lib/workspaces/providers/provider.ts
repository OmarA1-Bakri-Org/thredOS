import type { WorkspaceLimits } from '../config-schema'
import type {
  SnapshotManifest,
  SurfaceWorkspace,
  WorkspaceSnapshot,
} from '../schema'

export type WorkspaceProviderId = 'copy' | 'overlayfs' | 'container'

export interface WorkspaceProviderCapabilities {
  provider: WorkspaceProviderId
  isolationLabel: SurfaceWorkspace['isolation_label']
  supportsInternalSymlinks: boolean
  usesHardlinks: boolean
  requiresGit: boolean
}

export interface ProvisionWorkspaceRequest {
  workspaceId: string
  snapshot: WorkspaceSnapshot
  manifest: SnapshotManifest
  limits: WorkspaceLimits
}

export interface SurfaceWorkspaceState {
  workspace: SurfaceWorkspace
  treeExists: boolean
  manifestValid: boolean | null
  hasUsefulOutput: boolean | null
  issue: string | null
}

export interface SurfaceWorkspaceProvider {
  readonly id: WorkspaceProviderId
  capabilities(): WorkspaceProviderCapabilities
  provision(request: ProvisionWorkspaceRequest): Promise<SurfaceWorkspace>
  inspect(workspaceId: string): Promise<SurfaceWorkspaceState>
  freeze(workspaceId: string): Promise<SurfaceWorkspace>
  destroy(workspaceId: string): Promise<void>
}

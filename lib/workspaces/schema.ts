import { z } from 'zod'

export const SnapshotEntrySchema = z.object({
  path: z.string().min(1),
  kind: z.enum(['file', 'directory', 'symlink']),
  sha256: z.string().nullable(),
  size_bytes: z.number().int().nonnegative(),
  mode: z.number().int().nonnegative().nullable(),
  symlink_target: z.string().nullable(),
})
export type SnapshotEntry = z.infer<typeof SnapshotEntrySchema>

export const SnapshotManifestSchema = z.object({
  schema_version: z.literal(1),
  snapshot_id: z.string().min(1),
  root_manifest_hash: z.string().min(1),
  entries: z.array(SnapshotEntrySchema),
})
export type SnapshotManifest = z.infer<typeof SnapshotManifestSchema>

export const WorkspaceSnapshotStatusSchema = z.enum(['creating', 'ready', 'failed', 'deleted'])
export type WorkspaceSnapshotStatus = z.infer<typeof WorkspaceSnapshotStatusSchema>

export const WorkspaceSnapshotSchema = z.object({
  schema_version: z.literal(1),
  id: z.string().min(1),
  local_workspace_id: z.string().min(1),
  source_root: z.string().min(1),
  content_root: z.string().nullable(),
  manifest_ref: z.string().nullable(),
  status: WorkspaceSnapshotStatusSchema,
  root_manifest_hash: z.string().nullable(),
  exclusion_policy_hash: z.string().min(1),
  file_count: z.number().int().nonnegative(),
  total_bytes: z.number().int().nonnegative(),
  git_head: z.string().nullable(),
  git_dirty: z.boolean().nullable(),
  created_at: z.string().datetime(),
  verified_at: z.string().datetime().nullable(),
  error_code: z.string().nullable(),
})
export type WorkspaceSnapshot = z.infer<typeof WorkspaceSnapshotSchema>

export const SurfaceWorkspaceStatusSchema = z.enum([
  'planned',
  'materializing',
  'ready',
  'active',
  'frozen',
  'retained',
  'cleaning',
  'cleaned',
  'failed',
])
export type SurfaceWorkspaceStatus = z.infer<typeof SurfaceWorkspaceStatusSchema>

export const SurfaceWorkspaceSchema = z.object({
  schema_version: z.literal(1),
  id: z.string().min(1),
  revision: z.number().int().nonnegative(),
  workflow_run_id: z.string().min(1),
  attempt_id: z.string().min(1),
  surface_id: z.string().min(1),
  snapshot_id: z.string().min(1),
  provider: z.enum(['copy', 'overlayfs', 'container']),
  isolation_label: z.enum(['THREADOS_SCOPED', 'HOST_ENFORCED']),
  root_path: z.string().min(1),
  status: SurfaceWorkspaceStatusSchema,
  retention_policy: z.enum([
    'cleanup_on_success',
    'retain_until_applied',
    'retain_on_failure',
    'retain_always',
  ]),
  manifest_hash: z.string().nullable(),
  file_count: z.number().int().nonnegative(),
  total_bytes: z.number().int().nonnegative(),
  created_at: z.string().datetime(),
  ready_at: z.string().datetime().nullable(),
  cleaned_at: z.string().datetime().nullable(),
  error_code: z.string().nullable(),
})
export type SurfaceWorkspace = z.infer<typeof SurfaceWorkspaceSchema>

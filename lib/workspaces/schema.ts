import { posix, win32 } from 'path'
import { z } from 'zod'
import { assertSafePathSegment } from '@/lib/security/safe-path'

const Sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const WindowsReservedNamePattern = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i
const ControlCharacterPattern = /[\0-\x1F\x7F]/
const WindowsForbiddenCharacterPattern = /[<>"|?*]/
const MaxPortablePathSegmentLength = 255
const SafeNonNegativeIntegerSchema = z.number().int().nonnegative().refine(Number.isSafeInteger, {
  message: 'must be a nonnegative safe integer',
})

export function parseSnapshotSha256Digest(value: string): string {
  return Sha256DigestSchema.parse(value)
}

function addCustomIssue(context: z.RefinementCtx, path: (string | number)[], message: string): void {
  context.addIssue({
    code: z.ZodIssueCode.custom,
    path,
    message,
  })
}

function invalidSnapshotPath(label: string, message: string): Error {
  return new Error(`${label} ${message}`)
}

function normalizeNfc(value: string): string {
  return value.normalize('NFC')
}

function validatePortableSegments(
  value: string,
  label: string,
  options: { allowDotDot: boolean },
): string[] {
  const normalized = normalizeNfc(value)
  if (
    normalized.length === 0
    || normalized.includes('\\')
    || normalized.startsWith('//')
    || posix.isAbsolute(normalized)
    || win32.isAbsolute(normalized)
    || ControlCharacterPattern.test(normalized)
    || normalized.includes(':')
  ) {
    throw invalidSnapshotPath(label, 'must be a portable relative path')
  }

  if (posix.normalize(normalized) !== normalized) {
    throw invalidSnapshotPath(label, 'must be a normalized portable relative path')
  }

  const segments = normalized.split('/')
  if (segments.length === 0) throw invalidSnapshotPath(label, 'must not be empty')

  for (const segment of segments) {
    if (segment.length === 0) throw invalidSnapshotPath(label, 'must not contain empty segments')
    if (segment === '.') throw invalidSnapshotPath(label, 'must not contain "." segments')
    if (!options.allowDotDot && segment === '..') {
      throw invalidSnapshotPath(label, 'must not contain ".." segments')
    }
    if (segment !== '..' && /[. ]$/.test(segment)) {
      throw invalidSnapshotPath(label, 'must not contain segments ending with "." or space')
    }
    if (ControlCharacterPattern.test(segment)) {
      throw invalidSnapshotPath(label, 'must not contain control characters')
    }
    if (WindowsForbiddenCharacterPattern.test(segment)) {
      throw invalidSnapshotPath(label, 'must not contain Windows-forbidden characters')
    }
    if (segment.length > MaxPortablePathSegmentLength) {
      throw invalidSnapshotPath(label, `must not contain segments longer than ${MaxPortablePathSegmentLength} UTF-16 code units`)
    }
    if (segment !== '..' && WindowsReservedNamePattern.test(segment)) {
      throw invalidSnapshotPath(label, 'must not contain Windows reserved names')
    }
  }

  return segments
}

export function normalizeSnapshotRelativePath(value: string, label = 'snapshot path'): string {
  return validatePortableSegments(value, label, { allowDotDot: false }).join('/')
}

export function compareSnapshotPathBytes(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

export function normalizeSnapshotSymlinkTarget(
  entryPath: string,
  target: string,
  label = 'symlink_target',
): string {
  const normalizedEntryPath = normalizeSnapshotRelativePath(entryPath, 'snapshot entry path')
  const segments = validatePortableSegments(target, label, { allowDotDot: true })
  const normalizedTarget = segments.join('/')
  const baseDepth = normalizedEntryPath.split('/').slice(0, -1).length
  let depth = baseDepth
  for (const segment of segments) {
    if (segment === '..') {
      depth -= 1
      if (depth < 0) {
        throw invalidSnapshotPath(label, 'must not escape the snapshot root')
      }
      continue
    }
    depth += 1
  }

  return normalizedTarget
}

function ensurePortableRelativePath(
  value: string,
  label: string,
  context: z.RefinementCtx,
  path: (string | number)[],
): void {
  try {
    const normalized = normalizeSnapshotRelativePath(value, label)
    if (normalized !== value) {
      addCustomIssue(context, path, `${label} must use NFC-normalized Unicode`)
    }
  } catch (error) {
    addCustomIssue(context, path, error instanceof Error ? error.message : `${label} must be a portable relative path`)
  }
}

function ensurePortableSymlinkTarget(entryPath: string, value: string, context: z.RefinementCtx): void {
  try {
    const normalized = normalizeSnapshotSymlinkTarget(entryPath, value)
    if (normalized !== value) {
      addCustomIssue(context, ['symlink_target'], 'symlink_target must use NFC-normalized Unicode')
    }
  } catch (error) {
    addCustomIssue(context, ['symlink_target'], error instanceof Error ? error.message : 'symlink_target must be a portable normalized relative target')
  }
}

export const SnapshotEntrySchema = z.object({
  path: z.string().min(1),
  kind: z.enum(['file', 'directory', 'symlink']),
  sha256: Sha256DigestSchema.nullable(),
  size_bytes: SafeNonNegativeIntegerSchema,
  mode: SafeNonNegativeIntegerSchema.nullable(),
  symlink_target: z.string().nullable(),
}).superRefine((entry, context) => {
  ensurePortableRelativePath(entry.path, 'snapshot entry path', context, ['path'])

  if (entry.kind === 'file') {
    if (entry.sha256 == null) addCustomIssue(context, ['sha256'], 'file entries must include a sha256 digest')
    if (entry.symlink_target != null) addCustomIssue(context, ['symlink_target'], 'file entries must not include a symlink target')
    return
  }

  if (entry.sha256 != null) addCustomIssue(context, ['sha256'], `${entry.kind} entries must not include a sha256 digest`)
  if (entry.size_bytes !== 0) addCustomIssue(context, ['size_bytes'], `${entry.kind} entries must use size_bytes = 0`)

  if (entry.kind === 'directory') {
    if (entry.symlink_target != null) addCustomIssue(context, ['symlink_target'], 'directory entries must not include a symlink target')
    return
  }

  if (entry.symlink_target == null) {
    addCustomIssue(context, ['symlink_target'], 'symlink entries must include a symlink target')
    return
  }
  ensurePortableSymlinkTarget(entry.path, entry.symlink_target, context)
})
export type SnapshotEntry = z.infer<typeof SnapshotEntrySchema>

export const SnapshotManifestSchema = z.object({
  schema_version: z.literal(1),
  snapshot_id: z.string().min(1),
  root_manifest_hash: Sha256DigestSchema,
  entries: z.array(SnapshotEntrySchema),
}).superRefine((manifest, context) => {
  try {
    assertSafePathSegment(manifest.snapshot_id, 'snapshot id')
  } catch (error) {
    addCustomIssue(context, ['snapshot_id'], error instanceof Error ? error.message : 'snapshot id must be a file-safe identifier')
  }

  const seen = new Set<string>()
  manifest.entries.forEach((entry, index) => {
    let normalizedPath: string
    try {
      normalizedPath = normalizeSnapshotRelativePath(entry.path, 'snapshot entry path')
    } catch {
      return
    }
    if (seen.has(normalizedPath)) {
      addCustomIssue(context, ['entries', index, 'path'], `Duplicate snapshot entry path: ${normalizedPath}`)
    }
    seen.add(normalizedPath)
  })
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
  root_manifest_hash: Sha256DigestSchema.nullable(),
  exclusion_policy_hash: z.string().min(1),
  file_count: SafeNonNegativeIntegerSchema,
  total_bytes: SafeNonNegativeIntegerSchema,
  git_head: z.string().nullable(),
  git_dirty: z.boolean().nullable(),
  created_at: z.string().datetime(),
  verified_at: z.string().datetime().nullable(),
  error_code: z.string().nullable(),
  directory_count: SafeNonNegativeIntegerSchema.default(0),
  symlink_count: SafeNonNegativeIntegerSchema.default(0),
  blocked_symlink_paths: z.array(z.string()).default([]),
  source_retry_count: SafeNonNegativeIntegerSchema.default(0),
}).superRefine((snapshot, context) => {
  const blockedPaths = new Set<string>()
  snapshot.blocked_symlink_paths.forEach((path, index) => {
    try {
      const normalized = normalizeSnapshotRelativePath(path, 'blocked symlink path')
      if (normalized !== path) {
        addCustomIssue(context, ['blocked_symlink_paths', index], 'blocked symlink path must use NFC-normalized Unicode')
      }
      if (blockedPaths.has(normalized)) {
        addCustomIssue(context, ['blocked_symlink_paths', index], `Duplicate blocked symlink path: ${normalized}`)
      }
      blockedPaths.add(normalized)
    } catch (error) {
      addCustomIssue(context, ['blocked_symlink_paths', index], error instanceof Error ? error.message : 'blocked symlink path must be a portable relative path')
    }
  })

  const hasReadyRefs = snapshot.content_root != null
    && snapshot.manifest_ref != null
    && snapshot.root_manifest_hash != null
    && snapshot.verified_at != null

  if (snapshot.status === 'ready') {
    if (!hasReadyRefs) addCustomIssue(context, [], 'ready snapshots require content_root, manifest_ref, root_manifest_hash, and verified_at')
    if (snapshot.error_code != null) addCustomIssue(context, ['error_code'], 'ready snapshots must not include error_code')
    return
  }

  if (snapshot.status === 'failed') {
    if (snapshot.error_code == null) addCustomIssue(context, ['error_code'], 'failed snapshots require error_code')
    if (snapshot.content_root != null || snapshot.manifest_ref != null || snapshot.root_manifest_hash != null || snapshot.verified_at != null) {
      addCustomIssue(context, [], 'failed snapshots must not include ready-state evidence')
    }
    return
  }

  if (snapshot.status === 'creating') {
    if (snapshot.error_code != null) addCustomIssue(context, ['error_code'], 'creating snapshots must not include error_code')
    if (snapshot.content_root != null || snapshot.manifest_ref != null || snapshot.root_manifest_hash != null || snapshot.verified_at != null) {
      addCustomIssue(context, [], 'creating snapshots must not include ready-state evidence')
    }
    return
  }

  if (snapshot.verified_at == null) {
    if (snapshot.content_root != null || snapshot.manifest_ref != null || snapshot.root_manifest_hash != null) {
      addCustomIssue(context, [], 'deleted snapshots without verified_at must not include partial ready-state evidence')
    }
    return
  }

  if (!hasReadyRefs) {
    addCustomIssue(context, [], 'deleted snapshots with verified_at must preserve complete ready-state evidence')
  }
  if (snapshot.error_code != null) {
    addCustomIssue(context, ['error_code'], 'deleted snapshots preserving ready-state evidence must not include error_code')
  }
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
  revision: SafeNonNegativeIntegerSchema,
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
  file_count: SafeNonNegativeIntegerSchema,
  total_bytes: SafeNonNegativeIntegerSchema,
  created_at: z.string().datetime(),
  ready_at: z.string().datetime().nullable(),
  cleaned_at: z.string().datetime().nullable(),
  error_code: z.string().nullable(),
})
export type SurfaceWorkspace = z.infer<typeof SurfaceWorkspaceSchema>

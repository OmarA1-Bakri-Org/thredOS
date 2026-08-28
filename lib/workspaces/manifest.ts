import { assertSafePathSegment } from '@/lib/security/safe-path'
import { hashCanonicalJson } from './hash'
import {
  SnapshotEntrySchema,
  SnapshotManifestSchema,
  compareSnapshotPathBytes,
  normalizeSnapshotRelativePath,
  normalizeSnapshotSymlinkTarget,
  type SnapshotEntry,
  type SnapshotManifest,
} from './schema'

export interface SnapshotManifestVerification {
  rootManifestHash: string
  fileCount: number
  directoryCount: number
  symlinkCount: number
  totalBytes: number
}

function compareEntries(left: SnapshotEntry, right: SnapshotEntry): number {
  return compareSnapshotPathBytes(left.path, right.path)
}

function canonicalEntry(entry: SnapshotEntry): SnapshotEntry {
  const normalizedPath = normalizeSnapshotRelativePath(entry.path, 'snapshot entry path')
  const normalizedTarget = entry.kind === 'symlink' && entry.symlink_target != null
    ? normalizeSnapshotSymlinkTarget(normalizedPath, entry.symlink_target, 'symlink_target')
    : null
  return SnapshotEntrySchema.parse({
    ...entry,
    path: normalizedPath,
    symlink_target: normalizedTarget,
  })
}

function addSafeInteger(left: number, right: number, label: string): number {
  const next = left + right
  if (!Number.isSafeInteger(next)) {
    throw new Error(`${label} exceeds Number.MAX_SAFE_INTEGER`)
  }
  return next
}

function sortAndValidateEntries(entries: readonly SnapshotEntry[]): SnapshotEntry[] {
  const normalized = entries.map(entry => canonicalEntry(entry))
  normalized.sort(compareEntries)

  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1]?.path === normalized[index]?.path) {
      throw new Error(`Duplicate snapshot entry path: ${normalized[index]?.path}`)
    }
  }
  return normalized
}

function buildRootManifestHash(entries: readonly SnapshotEntry[]): string {
  return hashCanonicalJson({
    schema_version: 1,
    entries: entries.map(entry => ({
      path: entry.path,
      kind: entry.kind,
      sha256: entry.sha256,
      size_bytes: entry.size_bytes,
      mode: entry.mode,
      symlink_target: entry.symlink_target,
    })),
  })
}

function assertSorted(entries: readonly SnapshotEntry[]): void {
  for (let index = 1; index < entries.length; index += 1) {
    if (compareEntries(entries[index - 1]!, entries[index]!) > 0) {
      throw new Error('Snapshot manifest entries must be sorted by path')
    }
  }
}

export function createSnapshotManifest(snapshotId: string, entries: readonly SnapshotEntry[]): SnapshotManifest {
  assertSafePathSegment(snapshotId, 'snapshot id')
  const normalizedEntries = sortAndValidateEntries(entries)
  const manifest = SnapshotManifestSchema.parse({
    schema_version: 1,
    snapshot_id: snapshotId,
    root_manifest_hash: buildRootManifestHash(normalizedEntries),
    entries: normalizedEntries,
  })
  verifySnapshotManifest(manifest)
  return manifest
}

export function verifySnapshotManifest(manifest: SnapshotManifest): SnapshotManifestVerification {
  const parsed = SnapshotManifestSchema.parse(manifest)
  assertSorted(parsed.entries)
  const recomputedRoot = buildRootManifestHash(parsed.entries)
  if (parsed.root_manifest_hash !== recomputedRoot) {
    throw new Error(`Snapshot root manifest hash mismatch: expected ${recomputedRoot}, received ${parsed.root_manifest_hash}`)
  }

  let fileCount = 0
  let directoryCount = 0
  let symlinkCount = 0
  let totalBytes = 0

  for (const entry of parsed.entries) {
    if (entry.kind === 'file') {
      fileCount = addSafeInteger(fileCount, 1, 'Snapshot manifest file_count')
      totalBytes = addSafeInteger(totalBytes, entry.size_bytes, 'Snapshot manifest total_bytes')
      continue
    }
    if (entry.kind === 'directory') {
      directoryCount = addSafeInteger(directoryCount, 1, 'Snapshot manifest directory_count')
      continue
    }
    symlinkCount = addSafeInteger(symlinkCount, 1, 'Snapshot manifest symlink_count')
  }

  return {
    rootManifestHash: recomputedRoot,
    fileCount,
    directoryCount,
    symlinkCount,
    totalBytes,
  }
}

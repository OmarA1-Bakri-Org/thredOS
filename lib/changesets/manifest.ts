import { lstat, readdir, readlink, realpath } from 'fs/promises'
import { join, relative, isAbsolute, sep } from 'path'
import { hashFileNoFollow } from '../security/safe-io'
import { createSnapshotManifest } from '../workspaces/manifest'
import { compareSnapshotPathBytes, normalizeSnapshotRelativePath, normalizeSnapshotSymlinkTarget, type SnapshotEntry, type SnapshotManifest } from '../workspaces/schema'
import type { ExclusionPolicy } from '../workspaces/exclusions'

export interface TreeScan {
  manifest: SnapshotManifest
  identities: ReadonlyMap<string, string>
}

function contained(root: string, candidate: string): boolean {
  const offset = relative(root, candidate)
  return offset === '' || (!isAbsolute(offset) && offset !== '..' && !offset.startsWith(`..${sep}`))
}

/** Scan a stopped attempt's tree using the verified baseline exclusion policy. */
export async function scanFinalWorkspace(root: string, snapshotId: string, limits: { maxFiles: number; maxBytes: number }, policy: ExclusionPolicy): Promise<TreeScan> {
  const rootStat = await lstat(root)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('CHANGE_SET_UNSAFE_ROOT: workspace root is not a plain directory')
  const canonicalRoot = await realpath(root)
  const sameRoot = process.platform === 'win32'
    ? canonicalRoot.toLocaleLowerCase('en-US') === root.toLocaleLowerCase('en-US')
    : canonicalRoot === root
  if (!sameRoot) throw new Error('CHANGE_SET_UNSAFE_ROOT: workspace root is an alias')
  const entries: SnapshotEntry[] = []
  const identities = new Map<string, string>()
  const seen = new Set<string>()
  let bytes = 0
  let files = 0

  async function walk(directory: string, prefix: string): Promise<void> {
    const before = await lstat(directory, { bigint: true })
    if (!before.isDirectory() || before.isSymbolicLink() || !contained(canonicalRoot, await realpath(directory))) {
      throw new Error('CHANGE_SET_UNSAFE_TREE: directory escaped or changed')
    }
    const children = await readdir(directory, { withFileTypes: true })
    children.sort((a, b) => compareSnapshotPathBytes(a.name.normalize('NFC'), b.name.normalize('NFC')))
    for (const child of children) {
      if (!prefix && child.name === '.threados-runtime') {
        const internal = await lstat(join(directory, child.name))
        if (!internal.isDirectory() || internal.isSymbolicLink()) throw new Error('CHANGE_SET_UNSAFE_PATH: runtime event channel replaced')
        continue
      }
      const path = normalizeSnapshotRelativePath(prefix ? `${prefix}/${child.name}` : child.name)
      if (path !== (prefix ? `${prefix}/${child.name}` : child.name) || seen.has(path)) {
        throw new Error(`CHANGE_SET_UNSAFE_PATH: duplicate or nonportable path ${path}`)
      }
      const absolute = join(directory, child.name)
      const parent = await lstat(directory, { bigint: true })
      if (parent.dev !== before.dev || parent.ino !== before.ino || !parent.isDirectory() || parent.isSymbolicLink()) {
        throw new Error('CHANGE_SET_SOURCE_RACED: parent directory changed')
      }
      const stat = await lstat(absolute, { bigint: true })
      const kind = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : null
      if (policy.shouldExclude(path, kind === 'directory')) continue
      seen.add(path)
      if (!kind || (kind === 'file' && stat.nlink !== BigInt(1))) throw new Error(`CHANGE_SET_UNSAFE_PATH: unsupported or linked entry ${path}`)
      const mode = Number(stat.mode & BigInt(0o777))
      let sha256: string | null = null
      let size = 0
      let target: string | null = null
      if (kind === 'file') {
        files += 1
        if (files > limits.maxFiles) throw new Error('CHANGE_SET_QUOTA_EXCEEDED: file count')
        const hashed = await hashFileNoFollow(absolute, limits.maxBytes - bytes)
        sha256 = `sha256:${hashed.sha256}`
        size = hashed.sizeBytes
        bytes += size
        if (bytes > limits.maxBytes) throw new Error('CHANGE_SET_QUOTA_EXCEEDED: bytes')
      } else if (kind === 'symlink') {
        const raw = (await readlink(absolute)).replaceAll('\\', '/')
        target = normalizeSnapshotSymlinkTarget(path, raw)
      }
      const after = await lstat(absolute, { bigint: true })
      if (stat.dev !== after.dev || stat.ino !== after.ino || stat.mtimeNs !== after.mtimeNs || stat.mode !== after.mode || stat.size !== after.size) {
        throw new Error(`CHANGE_SET_SOURCE_RACED: ${path}`)
      }
      identities.set(path, `${stat.dev}:${stat.ino}:${stat.mtimeNs}:${stat.size}:${stat.mode}`)
      entries.push({ path, kind, sha256, size_bytes: size, mode, symlink_target: target })
      if (kind === 'directory') await walk(absolute, path)
    }
    const after = await lstat(directory, { bigint: true })
    if (before.dev !== after.dev || before.ino !== after.ino || before.mtimeNs !== after.mtimeNs || before.mode !== after.mode) {
      throw new Error('CHANGE_SET_SOURCE_RACED: directory changed')
    }
    identities.set(prefix || '.', `${before.dev}:${before.ino}:${before.mtimeNs}:${before.size}:${before.mode}`)
  }
  await walk(canonicalRoot, '')
  return { manifest: createSnapshotManifest(snapshotId, entries), identities }
}

export function sameTreeScan(left: TreeScan, right: TreeScan): boolean {
  if (left.manifest.root_manifest_hash !== right.manifest.root_manifest_hash || left.identities.size !== right.identities.size) return false
  for (const [path, identity] of left.identities) if (right.identities.get(path) !== identity) return false
  return true
}

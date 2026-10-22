import { lstat, readdir, readlink, realpath } from 'fs/promises'
import { isAbsolute, join, relative, sep } from 'path'
import { normalizeSnapshotRelativePath, normalizeSnapshotSymlinkTarget } from '../workspaces/schema'

/** A stopped scoped tree audit, including excluded dependencies; this is not host containment. */
export async function auditCandidateValidationTree(root: string, expectedIdentity: string,
  limits: { maxFiles: number; maxBytes: number }): Promise<void> {
  const before = await lstat(root)
  if (!before.isDirectory() || before.isSymbolicLink() || await realpath(root) !== root
    || `${before.dev}:${before.ino}` !== expectedIdentity) throw new Error('CHANGE_SET_UNSAFE_ROOT')
  let files = 0, bytes = 0
  const inside = (path: string) => { const part = relative(root, path); return !isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`) }
  async function walk(directory: string): Promise<void> {
    const first = await lstat(directory)
    if (!first.isDirectory() || first.isSymbolicLink() || !inside(await realpath(directory))) throw new Error('CHANGE_SET_UNSAFE_TREE')
    for (const name of await readdir(directory)) {
      const path = join(directory, name), portable = relative(root, path).split(sep).join('/')
      if (normalizeSnapshotRelativePath(portable) !== portable) throw new Error('CHANGE_SET_UNSAFE_TREE')
      const item = await lstat(path)
      if (++files > limits.maxFiles) throw new Error('CHANGE_SET_QUOTA_EXCEEDED')
      if (item.isSymbolicLink()) {
        normalizeSnapshotSymlinkTarget(portable, (await readlink(path)).replaceAll('\\', '/'))
        if (!inside(await realpath(path))) throw new Error('CHANGE_SET_UNSAFE_TREE')
      } else if (item.isDirectory()) await walk(path)
      else if (item.isFile() && item.nlink === 1) {
        bytes += item.size
        if (bytes > limits.maxBytes) throw new Error('CHANGE_SET_QUOTA_EXCEEDED')
      } else throw new Error('CHANGE_SET_UNSAFE_TREE')
    }
    const after = await lstat(directory)
    if (first.dev !== after.dev || first.ino !== after.ino || first.mtimeMs !== after.mtimeMs) throw new Error('CHANGE_SET_SOURCE_RACED')
  }
  await walk(root)
  const after = await lstat(root)
  if (`${after.dev}:${after.ino}` !== expectedIdentity) throw new Error('CHANGE_SET_UNSAFE_ROOT')
}

import { chmod, lstat, mkdtemp, readdir, rmdir, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

const ownedRoots = new Map<string, { dev: number; ino: number }>()

/** Opt in only a fresh test-owned mkdtemp root, never an existing directory. */
export async function createFixtureRoot(prefix: string): Promise<string> {
  if (!/^threados-[a-z0-9-]+-$/.test(prefix)) throw new Error('Fixture prefix must be a threados- name ending in a dash')
  const root = await mkdtemp(join(tmpdir(), prefix))
  const stat = await lstat(root)
  ownedRoots.set(root, { dev: stat.dev, ino: stat.ino })
  return root
}

async function lookup(path: string) {
  try {
    return await lstat(path)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
}

async function removeEntry(path: string): Promise<void> {
  const stat = await lookup(path)
  if (!stat) return
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    await unlink(path)
    return
  }
  // POSIX deletion needs writable parent directories; files need no chmod.
  // Never follow a link or relax permissions outside this owned fixture tree.
  await chmod(path, (stat.mode & 0o7777) | 0o700)
  for (const entry of await readdir(path)) await removeEntry(join(path, entry))
  await rmdir(path)
}

/** Remove only roots created here, restoring directory access for teardown. */
export async function removeFixtureTree(root: string): Promise<void> {
  const expected = ownedRoots.get(root)
  if (!expected) throw new Error('Fixture root was not created by createFixtureRoot')
  const stat = await lookup(root)
  if (!stat) return
  if (stat.isSymbolicLink()) {
    await unlink(root)
    return
  }
  if (!stat.isDirectory() || stat.dev !== expected.dev || stat.ino !== expected.ino) {
    throw new Error('Fixture root identity changed; refusing cleanup')
  }
  await removeEntry(root)
}

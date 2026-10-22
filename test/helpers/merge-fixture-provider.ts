import { constants } from 'fs'
import { lstat, open, rename, unlink, realpath } from 'fs/promises'
import { isAbsolute, relative, resolve, sep } from 'path'
import type { MergeMutationProvider } from '../../lib/merge/mutation-provider'
import { copyFileNoFollow, hashFileNoFollow } from '../../lib/security/safe-io'
import { resolveExistingPathWithinRoot, resolvePathWithinRoot } from '../../lib/security/safe-path'

/** Owned temporary fixture only. This DOES NOT model Windows containment or pending NT I/O. */
export function ownedFixtureMergeProvider(root: string, fault?: (operation: string, ordinal: number) => 'failed' | 'indeterminate' | null): MergeMutationProvider {
  const canonical = resolve(root)
  let ordinal = 0
  return {
    name: 'owned-fixture-only',
    assertAvailable() {
      const part = relative('/tmp', canonical)
      if (isAbsolute(part) || part.startsWith(`..${sep}`) || !part.startsWith('threados-pr11-proof-') || !part.endsWith(`${sep}canonical`)) {
        throw new Error('MERGE_FIXTURE_ROOT_REQUIRED')
      }
    },
    async rootIdentity(path) {
      if (path !== canonical || await realpath(path) !== path) throw new Error('MERGE_FIXTURE_ROOT_REQUIRED')
      const stat = await lstat(path)
      return `${stat.dev}:${stat.ino}`
    },
    async mutate({ canonicalRoot, transaction, operation, contentFile }) {
      this.assertAvailable()
      if (canonicalRoot !== canonical || await this.rootIdentity(canonical) !== transaction.authority?.root_identity) {
        throw new Error('MERGE_FIXTURE_ROOT_CHANGED')
      }
      const forced = fault?.(operation.kind, ordinal++)
      if (forced) return { status: forced, journalPath: null, pid: null, code: 'MERGE_FIXTURE_INJECTED_FAILURE' }
      const destination = operation.destination ? await resolvePathWithinRoot(canonical, ...operation.destination.split('/')) : ''
      if (operation.kind === 'stage') {
        if (!contentFile) throw new Error('MERGE_FIXTURE_CONTENT_REQUIRED')
        const copied = await copyFileNoFollow(contentFile, destination, { maxBytes: operation.size_bytes })
        if (`sha256:${copied.sha256}` !== operation.expected_sha256) throw new Error('MERGE_FIXTURE_CONTENT_CHANGED')
        const handle = await open(destination, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0))
        try { await handle.chmod(operation.mode); await handle.sync() } finally { await handle.close() }
      } else {
        const source = await resolveExistingPathWithinRoot(canonical, ...operation.source.split('/'))
        const item = await lstat(source), digest = await hashFileNoFollow(source)
        if (!item.isFile() || item.nlink !== 1 || `sha256:${digest.sha256}` !== operation.expected_sha256
          || digest.sizeBytes !== operation.size_bytes) throw new Error('MERGE_FIXTURE_SOURCE_CHANGED')
        if (operation.kind === 'delete') await unlink(source)
        else {
          try { await lstat(destination); throw new Error('MERGE_FIXTURE_DESTINATION_EXISTS') }
          catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
          await rename(source, destination)
        }
      }
      return { status: 'succeeded', journalPath: null, pid: null, code: 'MERGE_FIXTURE_SUCCEEDED' }
    },
  }
}

import { createRequire } from 'module'
import { dirname, join, resolve } from 'path'
import { mkdir } from 'fs/promises'
import { hashCanonicalJson } from '../workspaces/hash'
import type { MergeMutationProvider } from './mutation-provider'
import { runWindowsApplyHelper } from './windows-helper-client'

interface NativeIdentity { identity(root: string, relative: string, directory: boolean): string }

/** Explicit server wiring only. The normal runtime factory does not enable canonical mutation. */
export function createWindowsMergeMutationProvider(options: { nativeDirectory: string; executablePath: string }): MergeMutationProvider {
  let native: NativeIdentity | null = null
  const directory = resolve(options.nativeDirectory)
  const load = () => {
    if (process.platform !== 'win32') throw new Error('MERGE_UNSUPPORTED_PLATFORM')
    try { native ??= createRequire(join(directory, 'index.cjs'))('./index.cjs') as NativeIdentity }
    catch { throw new Error('MERGE_APPLY_CAPABILITY_UNAVAILABLE') }
    return native
  }
  return {
    name: 'windows-protected-helper',
    assertAvailable() { load() },
    async rootIdentity(root) { return load().identity(root, '', true) },
    async mutate({ canonicalRoot, evidenceRoot, transaction, operation, contentFile }) {
      const addon = load(), authority = transaction.authority
      if (!authority) throw new Error('MERGE_APPROVAL_EVIDENCE_MISSING')
      const parent = dirname(operation.destination).replaceAll('\\', '/')
      const journalDir = join(evidenceRoot, 'helpers')
      await mkdir(journalDir, { recursive: true })
      const result = await runWindowsApplyHelper({ journalDir, helperPath: join(directory, 'helper.cjs'),
        executablePath: options.executablePath, timeoutMs: 30_000,
        request: { schema_version: 1, operation_id: operation.id, root: canonicalRoot,
          expected_root_id: authority.root_identity,
          source: operation.source || operation.destination,
          expected_source_id: operation.kind === 'stage' ? authority.root_identity : addon.identity(canonicalRoot, operation.source, false),
          destination: operation.destination,
          expected_destination_parent_id: operation.kind === 'delete' ? '' : addon.identity(canonicalRoot, parent === '.' ? '' : parent, true),
          kind: operation.kind, plan_id: transaction.result.merge_plan_id, plan_hash: transaction.plan_digest,
          preview_hash: transaction.preview_manifest_hash, approval_hash: hashCanonicalJson({ apply: authority, rollback: transaction.rollback_authorities.at(-1) ?? null, phase: transaction.phase }), root_hash: transaction.canonical_root_hash,
          ...(operation.kind === 'stage' ? { content_file: contentFile } : {}),
          expected_sha256: operation.expected_sha256, expected_size: operation.size_bytes, expected_mode: operation.mode } })
      return { status: result.status, journalPath: result.journalPath, pid: result.pid, code: result.code }
    },
  }
}

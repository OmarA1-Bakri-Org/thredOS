import type { MergePreview } from './schema'
import type { SnapshotManifest } from '../workspaces/schema'
import type { MergeMutation, MergeTransactionRecord } from './result-repository'

/** Server-owned port. Request data can never install a provider or choose an executable. */
export interface MergeMutationProvider {
  readonly name: 'windows-protected-helper' | 'owned-fixture-only'
  assertAvailable(): void
  rootIdentity(canonicalRoot: string): Promise<string>
  mutate(input: { canonicalRoot: string; evidenceRoot: string; transaction: MergeTransactionRecord;
    operation: MergeMutation; contentFile?: string }): Promise<{
      status: 'succeeded' | 'failed' | 'indeterminate'; journalPath: string | null;
      pid: number | null; code: string
    }>
}

/** The first transaction slice supports regular files in existing directories only. */
export function assertMergeFileCapabilities(decision: MergePreview, before: SnapshotManifest,
  after: SnapshotManifest): void {
  if (decision.conflicts.length || decision.canonical_precondition_hash !== before.root_manifest_hash) {
    throw new Error('MERGE_CONFLICTS_UNRESOLVED')
  }
  const old = new Map(before.entries.map(entry => [entry.path, entry]))
  const next = new Map(after.entries.map(entry => [entry.path, entry]))
  for (const path of new Set([...old.keys(), ...next.keys()])) {
    const a = old.get(path), b = next.get(path)
    if (JSON.stringify(a) === JSON.stringify(b)) continue
    if ((a && a.kind !== 'file') || (b && b.kind !== 'file')
      || (a && b && a.mode !== b.mode)) throw new Error('MERGE_OPERATION_UNSUPPORTED')
  }
}

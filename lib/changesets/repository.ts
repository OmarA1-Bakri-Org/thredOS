import { mkdir } from 'fs/promises'
import { join } from 'path'
import { withExclusiveFileLock, writeFileAtomic } from '../fs/atomic'
import { readTextFileNoFollow } from '../security/safe-io'
import { assertSafePathSegment, resolveExistingPathWithinRoot, resolvePathWithinRoot } from '../security/safe-path'
import { verifySnapshotManifest } from '../workspaces/manifest'
import { hashCanonicalJson } from '../workspaces/hash'
import { SnapshotManifestSchema, type SnapshotManifest } from '../workspaces/schema'
import { ChangeSetSchema, type ChangeSet } from './schema'
import { ChangeSetContentStore } from './content-store'
import { RuntimeRepositoryError } from '../runtime/run-repository'

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function verifyRecord(value: unknown): ChangeSet {
  const version = value && typeof value === 'object'
    ? (value as { schema_version?: unknown }).schema_version : undefined
  if (version !== 2) {
    throw new RuntimeRepositoryError('CHANGE_SET_SCHEMA_UPGRADE_REQUIRED',
      'Legacy Change Set hash contract cannot be reinterpreted; create a new attempt')
  }
  const record = ChangeSetSchema.parse(value)
  const expected = hashCanonicalJson({
    baseline_snapshot_id: record.baseline_snapshot_id,
    baseline_manifest_hash: record.baseline_manifest_hash,
    final_workspace_manifest_hash: record.final_workspace_manifest_hash,
    entries: record.entries,
    validation_commands_required: record.validation.required_commands,
    path_scopes: record.path_scopes,
    path_scope_violations: record.path_scope_violations,
  })
  if (record.change_set_root_hash !== expected) throw new Error('CHANGE_SET_RECORD_CORRUPT: root hash mismatch')
  if (record.total_bytes !== record.entries.reduce((sum, entry) => sum + entry.size_bytes_after, 0)) {
    throw new Error('CHANGE_SET_RECORD_CORRUPT: total bytes mismatch')
  }
  return record
}

function immutableContent(record: ChangeSet): Omit<ChangeSet, 'revision' | 'status' | 'decision'> {
  const { revision: _revision, status: _status, decision: _decision, ...content } = record
  return content
}

function immutableCapture(record: ChangeSet): Omit<ChangeSet,
  'revision' | 'status' | 'decision' | 'validation' | 'output_contract_state' | 'approval_state'> {
  const { revision: _revision, status: _status, decision: _decision,
    validation: _validation, output_contract_state: _output, approval_state: _approval, ...content } = record
  return content
}

export class ChangeSetRepository {
  private readonly content: ChangeSetContentStore

  constructor(private readonly options: {
    canonicalRoot: string
    runtimeDataRoot: string
    namespace: string
    runId: string
    attemptId: string
  }) {
    this.content = new ChangeSetContentStore(options.runtimeDataRoot, options.namespace, options.runId, options.attemptId)
  }

  private get canonicalRoot(): string { return this.options.canonicalRoot }

  static async identity(canonicalRoot: string, id: string): Promise<{ runId: string; attemptId: string } | null> {
    assertSafePathSegment(id, 'change set id')
    try {
      const path = await resolveExistingPathWithinRoot(canonicalRoot, '.threados', 'changesets', `${id}.json`)
      const record = verifyRecord(JSON.parse(await readTextFileNoFollow(path)))
      if (record.id !== id) throw new Error('CHANGE_SET_IDENTITY_MISMATCH')
      return { runId: record.workflow_run_id, attemptId: record.attempt_id }
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  }

  private async directory(): Promise<string> {
    const path = await resolvePathWithinRoot(this.canonicalRoot, '.threados', 'changesets')
    await mkdir(path, { recursive: true })
    return path
  }

  async get(id: string): Promise<ChangeSet | null> {
    assertSafePathSegment(id, 'change set id')
    try {
      const path = await resolveExistingPathWithinRoot(this.canonicalRoot, '.threados', 'changesets', `${id}.json`)
      const record = verifyRecord(JSON.parse(await readTextFileNoFollow(path)))
      if (record.id !== id || record.workflow_run_id !== this.options.runId || record.attempt_id !== this.options.attemptId) {
        throw new Error('CHANGE_SET_IDENTITY_MISMATCH')
      }
      for (const entry of record.entries) {
        if (!entry.content_ref) continue
        try {
          if (!entry.after_sha256 || !await this.content.verify(entry.content_ref, entry.after_sha256, entry.size_bytes_after)) {
            throw new Error('Blob bytes or size do not match the Change Set entry')
          }
        } catch (error) {
          throw new Error('CHANGE_SET_CONTENT_CORRUPT', { cause: error })
        }
      }
      return record
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  }

  async getManifest(id: string): Promise<SnapshotManifest | null> {
    assertSafePathSegment(id, 'change set id')
    try {
      const path = await resolveExistingPathWithinRoot(this.canonicalRoot, '.threados', 'changesets', `${id}.manifest.json`)
      const manifest = SnapshotManifestSchema.parse(JSON.parse(await readTextFileNoFollow(path)))
      verifySnapshotManifest(manifest)
      return manifest
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  }

  async create(value: ChangeSet, manifestValue: SnapshotManifest): Promise<ChangeSet> {
    const changeSet = verifyRecord(value)
    assertSafePathSegment(changeSet.id, 'change set id')
    if (changeSet.revision !== 0 || changeSet.status !== 'captured' || changeSet.decision !== null) {
      throw new RuntimeRepositoryError('CHANGE_SET_INVALID_TRANSITION', 'New Change Sets must begin captured at revision zero')
    }
    if (changeSet.workflow_run_id !== this.options.runId || changeSet.attempt_id !== this.options.attemptId) {
      throw new Error('CHANGE_SET_IDENTITY_MISMATCH')
    }
    const manifest = SnapshotManifestSchema.parse(manifestValue)
    verifySnapshotManifest(manifest)
    if (manifest.root_manifest_hash !== changeSet.final_workspace_manifest_hash || manifest.snapshot_id !== changeSet.baseline_snapshot_id) {
      throw new Error('CHANGE_SET_MANIFEST_MISMATCH')
    }
    const directory = await this.directory()
    return withExclusiveFileLock(join(directory, `${changeSet.id}.lock`), async () => {
      const existing = await this.get(changeSet.id)
      if (existing) {
        if (existing.change_set_root_hash !== changeSet.change_set_root_hash
          || existing.step_id !== changeSet.step_id || existing.surface_id !== changeSet.surface_id
          || existing.agent_ref !== changeSet.agent_ref || existing.workspace_id !== changeSet.workspace_id
          || existing.baseline_snapshot_id !== changeSet.baseline_snapshot_id
          || existing.baseline_manifest_hash !== changeSet.baseline_manifest_hash
          || JSON.stringify(existing.path_scopes) !== JSON.stringify(changeSet.path_scopes)
          || existing.final_workspace_manifest_hash !== changeSet.final_workspace_manifest_hash) {
          throw new Error('CHANGE_SET_CONFLICT: attempt already captured different lineage or bytes')
        }
        return existing
      }
      await writeFileAtomic(join(directory, `${changeSet.id}.manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`, { allowedRoot: this.canonicalRoot })
      await writeFileAtomic(join(directory, `${changeSet.id}.json`), `${JSON.stringify(changeSet, null, 2)}\n`, { allowedRoot: this.canonicalRoot })
      return changeSet
    }, { allowedRoot: this.canonicalRoot })
  }

  async update(id: string, expectedRevision: number, mutate: (current: ChangeSet) => ChangeSet): Promise<ChangeSet> {
    assertSafePathSegment(id, 'change set id')
    const directory = await this.directory()
    const path = join(directory, `${id}.json`)
    return withExclusiveFileLock(join(directory, `${id}.lock`), async () => {
      const current = await this.get(id)
      if (!current) throw new RuntimeRepositoryError('CHANGE_SET_NOT_FOUND', 'Change Set was not found')
      if (current.revision !== expectedRevision) {
        throw new RuntimeRepositoryError('CHANGE_SET_REVISION_CONFLICT',
          `Change Set revision ${current.revision} does not match expected ${expectedRevision}`)
      }
      const candidate = verifyRecord(ChangeSetSchema.parse({
        ...mutate(structuredClone(current)), revision: current.revision + 1,
      }))
      if (JSON.stringify(immutableContent(candidate)) !== JSON.stringify(immutableContent(current))) {
        throw new RuntimeRepositoryError('CHANGE_SET_INVALID_TRANSITION', 'Captured Change Set content is immutable')
      }
      if (!candidate.decision || candidate.decision.expected_revision !== expectedRevision
        || candidate.decision.action !== (candidate.status === 'selected' ? 'select' : 'reject')
        || !((current.status === 'captured' || current.status === 'validated')
          || (current.status === 'selected' && candidate.status === 'rejected'))
        || !['selected', 'rejected'].includes(candidate.status)) {
        throw new RuntimeRepositoryError('CHANGE_SET_INVALID_TRANSITION',
          `Change Set cannot transition from ${current.status} to ${candidate.status}`)
      }
      await writeFileAtomic(path, `${JSON.stringify(candidate, null, 2)}\n`, { allowedRoot: this.canonicalRoot })
      return candidate
    }, { allowedRoot: this.canonicalRoot })
  }

  async finalizeEvidence(id: string, expectedRevision: number, evidence: {
    validation: ChangeSet['validation']
    outputContractState: ChangeSet['output_contract_state']
    approvalState: 'not_required'
  }): Promise<ChangeSet> {
    assertSafePathSegment(id, 'change set id')
    const directory = await this.directory()
    const path = join(directory, `${id}.json`)
    return withExclusiveFileLock(join(directory, `${id}.lock`), async () => {
      const current = await this.get(id)
      if (!current) throw new RuntimeRepositoryError('CHANGE_SET_NOT_FOUND', 'Change Set was not found')
      if (current.revision !== expectedRevision) throw new RuntimeRepositoryError(
        'CHANGE_SET_REVISION_CONFLICT', 'Change Set revision changed during evidence finalization')
      if (current.status !== 'captured' || current.decision !== null
        || evidence.validation.required_commands !== current.validation.required_commands) {
        throw new RuntimeRepositoryError('CHANGE_SET_INVALID_TRANSITION',
          'Only an undecided captured Change Set can finalize evidence')
      }
      const passes = evidence.validation.status === 'passed'
        && evidence.outputContractState === 'passed'
        && evidence.approvalState === 'not_required'
      const candidate = verifyRecord(ChangeSetSchema.parse({
        ...current, revision: current.revision + 1,
        status: passes ? 'validated' : 'captured',
        validation: evidence.validation,
        output_contract_state: evidence.outputContractState,
        approval_state: evidence.approvalState,
      }))
      if (JSON.stringify(immutableCapture(candidate)) !== JSON.stringify(immutableCapture(current))) {
        throw new RuntimeRepositoryError('CHANGE_SET_INVALID_TRANSITION', 'Captured Change Set content is immutable')
      }
      await writeFileAtomic(path, `${JSON.stringify(candidate, null, 2)}\n`, { allowedRoot: this.canonicalRoot })
      return candidate
    }, { allowedRoot: this.canonicalRoot })
  }
}

import { describe, expect, test } from 'bun:test'
import { hashCanonicalJson } from '../workspaces/hash'
import { createSnapshotManifest } from '../workspaces/manifest'
import type { MergePreview } from './schema'
import { createMergePlanSubject, hashMergePlanSubject,
  verifyMergePlanSubjectForApply } from './subject'

const timestamp = '2026-09-29T00:00:00.000Z'
const digest = (character: string) => `sha256:${character.repeat(64)}`

function fixture() {
  const manifest = createSnapshotManifest('preview-1', [])
  const decision: MergePreview = {
    schema_version: 1, baseline_snapshot_id: 'baseline-1', baseline_manifest_hash: digest('b'),
    candidate_snapshot_id: 'candidate-1', candidate_manifest_hash: digest('c'),
    canonical_precondition_hash: digest('a'), change_set_ids: ['change-1'], entries: [], conflicts: [],
  }
  const subject = createMergePlanSubject({
    plan: { schema_version: 1, id: 'merge-1', revision: 2,
      workflow_run_id: 'run-1', baseline_snapshot_id: 'baseline-1', change_set_ids: ['change-1'],
      canonical_precondition_hash: digest('a'), preview_workspace_id: 'preview-1', conflicts: [],
      status: 'validated', created_at: timestamp, validated_at: timestamp },
    binding: { candidate_manifest_hash: digest('c'),
      selected_change_sets: [{ id: 'change-1', change_set_root_hash: digest('d') }] },
    preview: { schema_version: 1, id: 'preview-1', revision: 1, merge_plan_id: 'merge-1',
      workflow_run_id: 'run-1', canonical_precondition_hash: digest('a'),
      candidate_manifest_hash: digest('c'), decision_hash: hashCanonicalJson(decision),
      status: 'ready', root_path: '/isolated/preview-1', manifest_hash: manifest.root_manifest_hash,
      error_code: null, created_at: timestamp, ready_at: timestamp },
    validation_receipt: { schema_version: 1, merge_plan_id: 'merge-1', plan_revision: 1,
      actor: 'operator-1', idempotency_key: 'validate-1', validation_command_count: 0,
      validation_commands_hash: hashCanonicalJson([]), policy_snapshot_hash: digest('e'),
      status: 'completed', error_code: null, created_at: timestamp, completed_at: timestamp },
    canonical_precondition_hash: digest('a'),
  })
  const evidence = { decision, previewManifest: manifest,
    currentCanonicalManifestHash: digest('a'), currentValidationCommandCount: 0,
    currentValidationCommandsHash: hashCanonicalJson([]), currentPolicySnapshotHash: digest('e') }
  return { subject, evidence }
}

describe('versioned exact merge-plan subject', () => {
  test('approval and apply use one stable digest over persisted records and live W', () => {
    const { subject, evidence } = fixture()
    const approvedDigest = hashMergePlanSubject(subject)
    expect(approvedDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(verifyMergePlanSubjectForApply(subject, approvedDigest, evidence)).toBe(true)
    expect(hashMergePlanSubject(structuredClone(subject))).toBe(approvedDigest)
  })

  test('rejects the isolated apply formula that omitted validation receipt and W binding', () => {
    const { subject, evidence } = fixture()
    const oldApplyDigest = hashCanonicalJson({ plan: subject.plan, binding: subject.binding,
      preview: subject.preview, decision: evidence.decision, manifest: evidence.previewManifest })
    expect(oldApplyDigest).not.toBe(hashMergePlanSubject(subject))
    expect(verifyMergePlanSubjectForApply(subject, oldApplyDigest, evidence)).toBe(false)
  })

  test('rejects changed W, validation commands, policy, decision and preview manifest', () => {
    const { subject, evidence } = fixture()
    const approvedDigest = hashMergePlanSubject(subject)
    expect(verifyMergePlanSubjectForApply(subject, approvedDigest,
      { ...evidence, currentCanonicalManifestHash: digest('f') })).toBe(false)
    expect(verifyMergePlanSubjectForApply(subject, approvedDigest,
      { ...evidence, currentValidationCommandsHash: digest('f') })).toBe(false)
    expect(verifyMergePlanSubjectForApply(subject, approvedDigest,
      { ...evidence, currentPolicySnapshotHash: digest('f') })).toBe(false)
    expect(verifyMergePlanSubjectForApply(subject, approvedDigest,
      { ...evidence, decision: { ...evidence.decision, candidate_manifest_hash: digest('f') } })).toBe(false)
    expect(verifyMergePlanSubjectForApply(subject, approvedDigest,
      { ...evidence, previewManifest: { ...evidence.previewManifest,
        root_manifest_hash: digest('f') } })).toBe(false)
  })

  test('rejects a stale receipt revision or preview identity before issuing a digest', () => {
    const { subject } = fixture()
    expect(() => createMergePlanSubject({ ...subject,
      validation_receipt: { ...subject.validation_receipt, plan_revision: 0 } })).toThrow()
    expect(() => createMergePlanSubject({ ...subject,
      preview: { ...subject.preview, id: 'preview-other' } })).toThrow()
  })
})

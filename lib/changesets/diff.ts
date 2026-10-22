import { constants } from 'fs'
import { open } from 'fs/promises'
import { resolveExistingPathWithinRoot } from '../security/safe-path'
import { hashSha256Bytes } from '../workspaces/hash'
import { verifySnapshotManifest } from '../workspaces/manifest'
import { verifyWorkspaceTree } from '../workspaces/providers/copy'
import { compareSnapshotPathBytes, normalizeSnapshotRelativePath, type SnapshotManifest } from '../workspaces/schema'
import { ChangeSetContentStore } from './content-store'
import type { ChangeSet, ChangeSetEntry } from './schema'

const MAX_FILE_PREVIEW_BYTES = 32 * 1024
const MAX_TOTAL_PREVIEW_BYTES = 256 * 1024
const MAX_DIFF_LINES = 200
const MAX_REVIEW_ENTRIES = 1000

export interface ChangeSetSummary {
  schema_version: 1
  id: string
  revision: number
  workflow_run_id: string
  attempt_id: string
  step_id: string
  surface_id: string
  agent_ref: string | null
  workspace_id: string
  baseline_snapshot_id: string
  change_set_root_hash: string
  created_at: string
  status: ChangeSet['status']
  entry_count: number
  total_bytes: number
  path_scope_violations: string[]
  validation: ChangeSet['validation']
  output_contract_state: ChangeSet['output_contract_state']
  approval_state: ChangeSet['approval_state']
  decision: ChangeSet['decision']
}

export interface ChangeSetReviewEntry extends ChangeSetEntry {
  before_text: string | null
  after_text: string | null
  unified_diff: string | null
  preview_truncated: boolean
}

export interface ChangeSetReview {
  schema_version: 1
  summary: ChangeSetSummary
  entries: ChangeSetReviewEntry[]
  file_tree_truncated: boolean
  test_evidence_refs: string[]
}

export interface ChangeSetComparison {
  schema_version: 1
  left: ChangeSetSummary
  right: ChangeSetSummary
  paths: Array<{ path: string; relation: 'identical' | 'different' | 'left_only' | 'right_only' }>
  truncated: boolean
}

function safeRelativeRef(value: string): string {
  try { return normalizeSnapshotRelativePath(value) === value ? value : '[redacted]' }
  catch { return '[redacted]' }
}

export function summarizeChangeSet(record: ChangeSet): ChangeSetSummary {
  return {
    schema_version: 1, id: record.id, revision: record.revision,
    workflow_run_id: record.workflow_run_id, attempt_id: record.attempt_id,
    step_id: record.step_id, surface_id: record.surface_id, agent_ref: record.agent_ref,
    workspace_id: record.workspace_id, baseline_snapshot_id: record.baseline_snapshot_id,
    change_set_root_hash: record.change_set_root_hash, created_at: record.created_at,
    status: record.status, entry_count: record.entries.length, total_bytes: record.total_bytes,
    path_scope_violations: record.path_scope_violations.map(safeRelativeRef),
    validation: { ...record.validation, evidence_refs: record.validation.evidence_refs.map(safeRelativeRef) },
    output_contract_state: record.output_contract_state, approval_state: record.approval_state,
    decision: record.decision,
  }
}

function textLines(text: string): string[] {
  const lines = text.split('\n')
  if (text.endsWith('\n')) lines.pop()
  return lines
}

export function unifiedTextDiff(path: string, before: string, after: string): string | null {
  if (before === after) return null
  const oldLines = before.length ? textLines(before) : []
  const newLines = after.length ? textLines(after) : []
  if (oldLines.length > MAX_DIFF_LINES || newLines.length > MAX_DIFF_LINES) return null
  const rows = Array.from({ length: oldLines.length + 1 }, () => new Uint16Array(newLines.length + 1))
  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    for (let j = newLines.length - 1; j >= 0; j -= 1) {
      rows[i]![j] = oldLines[i] === newLines[j]
        ? rows[i + 1]![j + 1]! + 1
        : Math.max(rows[i + 1]![j]!, rows[i]![j + 1]!)
    }
  }
  const lines = [`--- a/${path}`, `+++ b/${path}`, `@@ -1,${oldLines.length} +1,${newLines.length} @@`]
  let i = 0
  let j = 0
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      lines.push(` ${oldLines[i]}`); i += 1; j += 1
    } else if (i < oldLines.length && (j === newLines.length || rows[i + 1]![j]! >= rows[i]![j + 1]!)) {
      lines.push(`-${oldLines[i]}`); i += 1
    } else {
      lines.push(`+${newLines[j]}`); j += 1
    }
  }
  return lines.join('\n')
}

async function baselineText(root: string, entry: ChangeSetEntry, manifest: SnapshotManifest): Promise<string | null> {
  if (entry.before_kind !== 'file' || !entry.before_sha256) return ''
  if (entry.size_bytes_before > MAX_FILE_PREVIEW_BYTES) return null
  const expected = manifest.entries.find(item => item.path === entry.path)
  if (!expected || expected.sha256 !== entry.before_sha256 || expected.size_bytes !== entry.size_bytes_before) {
    throw new Error('CHANGE_SET_BASELINE_MISMATCH')
  }
  const path = await resolveExistingPathWithinRoot(root, ...entry.path.split('/'))
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const bytes = await file.readFile()
    if (bytes.length !== entry.size_bytes_before || hashSha256Bytes(bytes) !== entry.before_sha256) {
      throw new Error('CHANGE_SET_BASELINE_MISMATCH')
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } finally { await file.close() }
}

export async function buildChangeSetReview(input: {
  record: ChangeSet
  baselineManifest: SnapshotManifest
  baselineContentRoot: string
  contentStore: ChangeSetContentStore
}): Promise<ChangeSetReview> {
  verifySnapshotManifest(input.baselineManifest)
  if (input.record.baseline_snapshot_id !== input.baselineManifest.snapshot_id
    || input.record.baseline_manifest_hash !== input.baselineManifest.root_manifest_hash) {
    throw new Error('CHANGE_SET_BASELINE_MISMATCH')
  }
  await verifyWorkspaceTree(input.baselineContentRoot, input.baselineManifest, { requireImmutable: true })
  let remaining = MAX_TOTAL_PREVIEW_BYTES
  const entries: ChangeSetReviewEntry[] = []
  for (const entry of input.record.entries.slice(0, MAX_REVIEW_ENTRIES)) {
    let beforeText: string | null = null
    let afterText: string | null = null
    let previewTruncated = false
    if (entry.content_kind === 'text' && (entry.before_kind === 'file' || entry.after_kind === 'file')) {
      if (entry.size_bytes_before + entry.size_bytes_after > remaining) {
        previewTruncated = true
      } else {
        beforeText = await baselineText(input.baselineContentRoot, entry, input.baselineManifest)
        if (entry.after_kind === 'file' && entry.after_sha256 && entry.content_ref) {
          const afterBytes = await input.contentStore.read(entry.content_ref, entry.after_sha256, MAX_FILE_PREVIEW_BYTES)
          afterText = afterBytes ? new TextDecoder('utf-8', { fatal: true }).decode(afterBytes) : null
        } else if (entry.after_kind === null) {
          afterText = ''
        }
        previewTruncated = beforeText === null || afterText === null
        if (!previewTruncated) remaining -= entry.size_bytes_before + entry.size_bytes_after
      }
    }
    entries.push({ ...entry, patch_ref: entry.patch_ref ? safeRelativeRef(entry.patch_ref) : null,
      before_text: beforeText, after_text: afterText,
      unified_diff: beforeText !== null && afterText !== null
        ? unifiedTextDiff(entry.path, beforeText, afterText)
        : null,
      preview_truncated: previewTruncated,
    })
  }
  return {
    schema_version: 1, summary: summarizeChangeSet(input.record), entries,
    file_tree_truncated: input.record.entries.length > MAX_REVIEW_ENTRIES,
    test_evidence_refs: input.record.validation.evidence_refs.map(safeRelativeRef),
  }
}

function sameEntry(left: ChangeSetEntry, right: ChangeSetEntry): boolean {
  return left.operation === right.operation && left.before_sha256 === right.before_sha256
    && left.after_sha256 === right.after_sha256 && left.before_kind === right.before_kind
    && left.after_kind === right.after_kind && left.mode_before === right.mode_before
    && left.mode_after === right.mode_after && left.symlink_target_before === right.symlink_target_before
    && left.symlink_target_after === right.symlink_target_after
    && left.content_kind === right.content_kind
    && left.size_bytes_before === right.size_bytes_before
    && left.size_bytes_after === right.size_bytes_after
}

export function compareChangeSets(left: ChangeSet, right: ChangeSet): ChangeSetComparison {
  if (left.baseline_snapshot_id !== right.baseline_snapshot_id || left.baseline_manifest_hash !== right.baseline_manifest_hash) {
    throw new Error('CHANGE_SET_BASELINE_MISMATCH')
  }
  const leftPaths = new Map(left.entries.map(entry => [entry.path, entry]))
  const rightPaths = new Map(right.entries.map(entry => [entry.path, entry]))
  const paths = [...new Set([...leftPaths.keys(), ...rightPaths.keys()])].sort(compareSnapshotPathBytes)
  return {
    schema_version: 1, left: summarizeChangeSet(left), right: summarizeChangeSet(right),
    paths: paths.slice(0, MAX_REVIEW_ENTRIES).map(path => ({
      path,
      relation: !leftPaths.has(path) ? 'right_only' : !rightPaths.has(path) ? 'left_only'
        : sameEntry(leftPaths.get(path)!, rightPaths.get(path)!) ? 'identical' : 'different',
    })),
    truncated: paths.length > MAX_REVIEW_ENTRIES,
  }
}

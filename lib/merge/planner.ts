import { createHash } from 'crypto'
import { verifySnapshotManifest } from '../workspaces/manifest'
import { compareSnapshotPathBytes, normalizeSnapshotRelativePath, type SnapshotEntry } from '../workspaces/schema'
import { findPortablePathAlias, MergePreviewSchema, ThreeInputMergeRequestSchema, type MergeConflict, type MergePreview, type MergePreviewEntry, type ThreeInputMergeRequest } from './schema'

type Tree = 'baseline' | 'canonical' | 'candidate'
type TextEvidence = Partial<Record<Tree, Readonly<Record<string, string>>>>
const MaxMergeTextBytes = 1024 * 1024

interface TextHunk { start: number; end: number; replacement: string[] }

function sameEntry(left: SnapshotEntry | undefined, right: SnapshotEntry | undefined): boolean {
  if (!left || !right) return left === right
  return left.kind === right.kind && left.sha256 === right.sha256
    && left.size_bytes === right.size_bytes && left.mode === right.mode
    && left.symlink_target === right.symlink_target
}

function lines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

function hunk(base: readonly string[], changed: readonly string[]): TextHunk {
  let start = 0
  while (start < base.length && start < changed.length && base[start] === changed[start]) start += 1
  let suffix = 0
  while (suffix < base.length - start && suffix < changed.length - start
    && base[base.length - suffix - 1] === changed[changed.length - suffix - 1]) suffix += 1
  return { start, end: base.length - suffix, replacement: changed.slice(start, changed.length - suffix) }
}

/** Conservative line merge: independent single-hunk edits merge; ambiguous edits conflict. */
function mergeText(base: string, canonical: string, candidate: string): string | null {
  const baselineLines = lines(base)
  const canonicalHunk = hunk(baselineLines, lines(canonical))
  const candidateHunk = hunk(baselineLines, lines(candidate))
  const [first, second] = canonicalHunk.start <= candidateHunk.start
    ? [canonicalHunk, candidateHunk]
    : [candidateHunk, canonicalHunk]
  if (first.end >= second.start) return null
  return [
    ...baselineLines.slice(0, first.start),
    ...first.replacement,
    ...baselineLines.slice(first.end, second.start),
    ...second.replacement,
    ...baselineLines.slice(second.end),
  ].join('')
}

function checkedText(entry: SnapshotEntry, text: string | undefined): string | undefined {
  if (text === undefined) return undefined
  const digest = `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`
  if (entry.kind !== 'file' || entry.sha256 !== digest || entry.size_bytes !== Buffer.byteLength(text)) {
    throw new Error(`MERGE_TEXT_HASH_MISMATCH: ${entry.path}`)
  }
  return text
}

function conflict(
  path: string,
  kind: MergeConflict['kind'],
  baseline: SnapshotEntry | undefined,
  canonical: SnapshotEntry | undefined,
  candidate: SnapshotEntry | undefined,
  changeSetIds: string[],
): MergeConflict {
  const signature = JSON.stringify([path, kind, baseline ?? null, canonical ?? null, candidate ?? null, changeSetIds])
  return {
    id: `conflict-${createHash('sha256').update(signature).digest('hex').slice(0, 24)}`,
    path,
    kind,
    baseline_sha256: baseline?.sha256 ?? null,
    canonical_sha256: canonical?.sha256 ?? null,
    candidate_sha256: candidate?.sha256 ?? null,
    change_set_ids: changeSetIds,
    status: 'unresolved',
    resolution: null,
  }
}

function validateTextPaths(text: TextEvidence): void {
  for (const tree of ['baseline', 'canonical', 'candidate'] as const) {
    for (const path of Object.keys(text[tree] ?? {})) {
      if (normalizeSnapshotRelativePath(path) !== path) throw new Error(`MERGE_UNSAFE_PATH: ${path}`)
    }
  }
}

function assertTreeHierarchy(entries: readonly SnapshotEntry[]): void {
  const byPath = new Map(entries.map(entry => [entry.path, entry]))
  for (const entry of entries) {
    const segments = entry.path.split('/')
    for (let length = 1; length < segments.length; length += 1) {
      const parent = byPath.get(segments.slice(0, length).join('/'))
      if (parent && parent.kind !== 'directory') throw new Error(`MERGE_INVALID_TREE: ${entry.path}`)
    }
  }
}

function hasBlockedAncestor(path: string, baseline: ReadonlyMap<string, SnapshotEntry>, projected: ReadonlyMap<string, SnapshotEntry>): boolean {
  const segments = path.split('/')
  for (let length = 1; length < segments.length; length += 1) {
    const ancestor = segments.slice(0, length).join('/')
    const current = projected.get(ancestor)
    if (current && current.kind !== 'directory') return true
    if (!current && baseline.has(ancestor)) return true
  }
  return false
}

/** Pure B/W/C planning. It never reads or mutates the canonical workspace. */
export function planThreeInputMerge(raw: ThreeInputMergeRequest): MergePreview {
  const request = ThreeInputMergeRequestSchema.parse(raw)
  verifySnapshotManifest(request.baseline)
  verifySnapshotManifest(request.canonical)
  verifySnapshotManifest(request.candidate)
  assertTreeHierarchy(request.baseline.entries)
  assertTreeHierarchy(request.canonical.entries)
  assertTreeHierarchy(request.candidate.entries)
  const alias = findPortablePathAlias([
    ...request.baseline.entries.map(entry => entry.path),
    ...request.canonical.entries.map(entry => entry.path),
    ...request.candidate.entries.map(entry => entry.path),
    ...(request.candidateOperations ?? []).map(operation => operation.path),
  ])
  if (alias) throw new Error(`MERGE_PORTABLE_ALIAS: ${alias.existing} aliases ${alias.alias}`)
  const changeSetIds = [...new Set(request.changeSetIds)].sort(compareSnapshotPathBytes)
  if (changeSetIds.length === 0 || changeSetIds.some(id => id.length === 0)) throw new Error('MERGE_CHANGE_SET_IDS_REQUIRED')
  const text = request.text ?? {}
  validateTextPaths(text)
  const operations = new Map<string, NonNullable<ThreeInputMergeRequest['candidateOperations']>[number]>()
  for (const item of request.candidateOperations ?? []) {
    if (normalizeSnapshotRelativePath(item.path) !== item.path) throw new Error(`MERGE_UNSAFE_PATH: ${item.path}`)
    if (operations.has(item.path)) throw new Error(`MERGE_DUPLICATE_OPERATION: ${item.path}`)
    operations.set(item.path, item)
  }
  const baseline = new Map(request.baseline.entries.map(entry => [entry.path, entry]))
  const canonical = new Map(request.canonical.entries.map(entry => [entry.path, entry]))
  const candidate = new Map(request.candidate.entries.map(entry => [entry.path, entry]))
  const projected = new Map(canonical)
  const canonicalChangedPaths = [...new Set([...baseline.keys(), ...canonical.keys()])]
    .filter(path => !sameEntry(baseline.get(path), canonical.get(path)))
  const paths = [...new Set([...baseline.keys(), ...candidate.keys(), ...operations.keys()])].sort(compareSnapshotPathBytes)
  const entries: MergePreviewEntry[] = []
  const conflicts: MergeConflict[] = []

  for (const path of paths) {
    const b = baseline.get(path)
    const w = canonical.get(path)
    const c = candidate.get(path)
    const operation = operations.get(path)
    if (sameEntry(c, b) && operation?.operation !== 'rename') continue
    if (operation?.operation === 'rename') {
      conflicts.push(conflict(path, 'rename', b, w, c, changeSetIds))
      continue
    }
    if (c && hasBlockedAncestor(path, baseline, projected)) {
      conflicts.push(conflict(path, 'unsupported', b, w, c, changeSetIds))
      continue
    }
    if (sameEntry(w, c)) {
      entries.push({ path, decision: 'already_present', result: w ?? null, merged_text: null })
      continue
    }
    if (sameEntry(w, b)) {
      const canonicalChildChanged = c?.kind !== 'directory'
        && canonicalChangedPaths.some(child => child.startsWith(`${path}/`))
      if (canonicalChildChanged || (b?.kind === 'directory' && !c) || (b?.kind === 'symlink' || c?.kind === 'symlink')) {
        conflicts.push(conflict(path, 'unsupported', b, w, c, changeSetIds))
      } else {
        entries.push({ path, decision: 'candidate', result: c ?? null, merged_text: null })
        if (c) projected.set(path, c)
        else projected.delete(path)
      }
      continue
    }
    if (!b || !w || !c || b.kind !== w.kind || b.kind !== c.kind) {
      conflicts.push(conflict(path, 'delete_modify', b, w, c, changeSetIds))
      continue
    }
    if (b.mode !== w.mode || b.mode !== c.mode) {
      conflicts.push(conflict(path, 'permission', b, w, c, changeSetIds))
      continue
    }
    if (b.kind !== 'file') {
      conflicts.push(conflict(path, 'unsupported', b, w, c, changeSetIds))
      continue
    }
    if (operation?.content_kind === 'binary') {
      conflicts.push(conflict(path, 'binary', b, w, c, changeSetIds))
      continue
    }
    const bText = checkedText(b, text.baseline?.[path])
    const wText = checkedText(w, text.canonical?.[path])
    const cText = checkedText(c, text.candidate?.[path])
    if (bText === undefined || wText === undefined || cText === undefined) {
      conflicts.push(conflict(path, 'unsupported', b, w, c, changeSetIds))
      continue
    }
    if ([bText, wText, cText].some(value => Buffer.byteLength(value) > MaxMergeTextBytes)) {
      conflicts.push(conflict(path, 'unsupported', b, w, c, changeSetIds))
      continue
    }
    const merged = mergeText(bText, wText, cText)
    if (merged === null) {
      conflicts.push(conflict(path, 'text', b, w, c, changeSetIds))
      continue
    }
    const mergedEntry: SnapshotEntry = {
      path,
      kind: 'file',
      sha256: `sha256:${createHash('sha256').update(merged, 'utf8').digest('hex')}`,
      size_bytes: Buffer.byteLength(merged),
      mode: w.mode,
      symlink_target: null,
    }
    entries.push({
      path,
      decision: 'merged',
      result: mergedEntry,
      merged_text: merged,
    })
    projected.set(path, mergedEntry)
  }

  assertTreeHierarchy([...projected.values()])

  return MergePreviewSchema.parse({
    schema_version: 1,
    baseline_snapshot_id: request.baseline.snapshot_id,
    baseline_manifest_hash: request.baseline.root_manifest_hash,
    candidate_snapshot_id: request.candidate.snapshot_id,
    candidate_manifest_hash: request.candidate.root_manifest_hash,
    canonical_precondition_hash: request.canonical.root_manifest_hash,
    change_set_ids: changeSetIds,
    entries,
    conflicts,
  })
}

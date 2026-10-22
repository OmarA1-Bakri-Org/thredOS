import { createHash } from 'crypto'
import { describe, expect, test } from 'bun:test'
import { createSnapshotManifest } from '../workspaces/manifest'
import type { SnapshotEntry } from '../workspaces/schema'
import { planThreeInputMerge } from './planner'
import { MergePreviewSchema } from './schema'

function file(path: string, content: string, mode = 0o644): SnapshotEntry {
  return {
    path,
    kind: 'file',
    sha256: `sha256:${createHash('sha256').update(content).digest('hex')}`,
    size_bytes: Buffer.byteLength(content),
    mode,
    symlink_target: null,
  }
}

function fixture(
  baseline: SnapshotEntry[],
  canonical: SnapshotEntry[],
  candidate: SnapshotEntry[],
  text: { baseline?: Record<string, string>; canonical?: Record<string, string>; candidate?: Record<string, string> } = {},
) {
  return {
    baseline: createSnapshotManifest('baseline', baseline),
    canonical: createSnapshotManifest('canonical', canonical),
    candidate: createSnapshotManifest('candidate', candidate),
    changeSetIds: ['change-1'],
    text,
  }
}

describe('three-input merge planner', () => {
  test('applies candidate when canonical equals baseline and preserves unrelated canonical changes', () => {
    const input = fixture(
      [file('src/a.ts', 'base\n')],
      [file('src/a.ts', 'base\n'), file('src/local.ts', 'local\n')],
      [file('src/a.ts', 'candidate\n')],
    )
    const plan = planThreeInputMerge(input)
    expect(plan.canonical_precondition_hash).toBe(input.canonical.root_manifest_hash)
    expect(plan.entries).toEqual([{
      path: 'src/a.ts',
      decision: 'candidate',
      result: file('src/a.ts', 'candidate\n'),
      merged_text: null,
    }])
    expect(plan.conflicts).toEqual([])
  })

  test('omits candidate no-op and records already-present change', () => {
    const unchanged = planThreeInputMerge(fixture(
      [file('a.txt', 'base')], [file('a.txt', 'current')], [file('a.txt', 'base')],
    ))
    expect(unchanged.entries).toEqual([])
    const present = planThreeInputMerge(fixture(
      [file('a.txt', 'base')], [file('a.txt', 'candidate')], [file('a.txt', 'candidate')],
    ))
    expect(present.entries[0]?.decision).toBe('already_present')
  })

  test('merges independent text edits using baseline, canonical, and candidate', () => {
    const b = 'a\nb\nc\nd\ne\n'
    const w = 'a\nW\nc\nd\ne\n'
    const c = 'a\nb\nc\nC\ne\n'
    const plan = planThreeInputMerge(fixture(
      [file('a.txt', b)], [file('a.txt', w)], [file('a.txt', c)],
      { baseline: { 'a.txt': b }, canonical: { 'a.txt': w }, candidate: { 'a.txt': c } },
    ))
    expect(plan.conflicts).toEqual([])
    expect(plan.entries[0]?.decision).toBe('merged')
    expect(plan.entries[0]?.merged_text).toBe('a\nW\nc\nC\ne\n')
    expect(plan.entries[0]?.result?.sha256).toBe(file('a.txt', 'a\nW\nc\nC\ne\n').sha256)
  })

  test('reports overlapping text edits deterministically', () => {
    const input = fixture(
      [file('a.txt', 'a\nb\nc\n')],
      [file('a.txt', 'a\nW\nc\n')],
      [file('a.txt', 'a\nC\nc\n')],
      { baseline: { 'a.txt': 'a\nb\nc\n' }, canonical: { 'a.txt': 'a\nW\nc\n' }, candidate: { 'a.txt': 'a\nC\nc\n' } },
    )
    const first = planThreeInputMerge(input)
    expect(first).toEqual(planThreeInputMerge(input))
    expect(first.entries).toEqual([])
    expect(first.conflicts).toMatchObject([{ path: 'a.txt', kind: 'text', status: 'unresolved' }])
  })

  test('reports binary, delete/modify, permission, and rename conflicts explicitly', () => {
    const b = file('a.bin', 'base')
    const w = file('a.bin', 'canonical')
    const c = file('a.bin', 'candidate')
    const binary = planThreeInputMerge({
      ...fixture([b], [w], [c]),
      candidateOperations: [{ path: 'a.bin', operation: 'modify', content_kind: 'binary' }],
    })
    expect(binary.conflicts[0]?.kind).toBe('binary')
    const deleted = planThreeInputMerge(fixture([b], [], [c]))
    expect(deleted.conflicts[0]?.kind).toBe('delete_modify')
    const permission = planThreeInputMerge(fixture([b], [file('a.bin', 'base', 0o600)], [c]))
    expect(permission.conflicts[0]?.kind).toBe('permission')
    const renamed = planThreeInputMerge({ ...fixture([b], [b], [c]), candidateOperations: [{ path: 'a.bin', operation: 'rename' }] })
    expect(renamed.conflicts[0]?.kind).toBe('rename')
  })

  test('does not erase an unrelated current child when candidate replaces its parent', () => {
    const directory: SnapshotEntry = {
      path: 'src', kind: 'directory', sha256: null, size_bytes: 0, mode: 0o755, symlink_target: null,
    }
    const plan = planThreeInputMerge(fixture(
      [directory, file('src/base.txt', 'base')],
      [directory, file('src/base.txt', 'base'), file('src/local.txt', 'local')],
      [file('src', 'replacement')],
    ))
    expect(plan.conflicts.some(item => item.path === 'src' && item.kind === 'unsupported')).toBe(true)
  })

  test.each(['file', 'symlink'] as const)('blocks a candidate child beneath a canonical %s', kind => {
    const directory: SnapshotEntry = {
      path: 'src', kind: 'directory', sha256: null, size_bytes: 0, mode: 0o755, symlink_target: null,
    }
    const replacement: SnapshotEntry = kind === 'file' ? file('src', 'user') : {
      path: 'src', kind: 'symlink', sha256: null, size_bytes: 0, mode: 0o755, symlink_target: 'target',
    }
    const plan = planThreeInputMerge(fixture(
      [directory], [replacement], [directory, file('src/new.txt', 'candidate')],
    ))
    expect(plan.entries.some(item => item.path === 'src/new.txt')).toBe(false)
    expect(plan.conflicts.some(item => item.path === 'src/new.txt')).toBe(true)
  })

  test('rejects case-folded aliases across baseline, canonical, and candidate trees', () => {
    const input = fixture(
      [file('Readme', 'base')],
      [file('Readme', 'base')],
      [file('Readme', 'base'), file('README', 'candidate')],
    )
    expect(() => planThreeInputMerge(input)).toThrow('MERGE_PORTABLE_ALIAS')
    const parentAlias = fixture(
      [file('Source/a.txt', 'base')],
      [file('Source/a.txt', 'base')],
      [file('source/b.txt', 'candidate')],
    )
    expect(() => planThreeInputMerge(parentAlias)).toThrow('MERGE_PORTABLE_ALIAS')
  })

  test('honors binary metadata even when strings are provided', () => {
    const b = 'a\0\nb\nc\nd\ne\n'
    const w = 'a\0\nW\nc\nd\ne\n'
    const c = 'a\0\nb\nc\nC\ne\n'
    const plan = planThreeInputMerge({
      ...fixture([file('a.bin', b)], [file('a.bin', w)], [file('a.bin', c)],
        { baseline: { 'a.bin': b }, canonical: { 'a.bin': w }, candidate: { 'a.bin': c } }),
      candidateOperations: [{ path: 'a.bin', operation: 'modify', content_kind: 'binary' }],
    })
    expect(plan.entries).toEqual([])
    expect(plan.conflicts[0]?.kind).toBe('binary')
  })

  test('treats absent text evidence as unsupported rather than claiming a binary file', () => {
    const plan = planThreeInputMerge(fixture(
      [file('a.txt', 'base')], [file('a.txt', 'W')], [file('a.txt', 'C')],
    ))
    expect(plan.conflicts[0]?.kind).toBe('unsupported')
  })

  test('rejects unsafe paths and mismatched text evidence', () => {
    const input = fixture([file('a.txt', 'base')], [file('a.txt', 'W')], [file('a.txt', 'C')],
      { baseline: { 'a.txt': 'base' }, canonical: { 'a.txt': 'wrong' }, candidate: { 'a.txt': 'C' } })
    expect(() => planThreeInputMerge(input)).toThrow('MERGE_TEXT_HASH_MISMATCH')
    expect(() => planThreeInputMerge({ ...input, candidateOperations: [{ path: '../escape', operation: 'rename' }] })).toThrow()
  })

  test('rejects duplicate decisions for one path in a persisted preview', () => {
    const preview = planThreeInputMerge(fixture([file('a.txt', 'base')], [file('a.txt', 'base')], [file('a.txt', 'C')]))
    expect(MergePreviewSchema.safeParse({ ...preview, entries: [...preview.entries, ...preview.entries] }).success).toBe(false)
  })

  test('rejects case-folded aliases in a persisted preview', () => {
    const preview = planThreeInputMerge(fixture([], [], [file('Readme', 'C')]))
    expect(MergePreviewSchema.safeParse({
      ...preview,
      entries: [...preview.entries, {
        path: 'README', decision: 'candidate', result: file('README', 'other'), merged_text: null,
      }],
    }).success).toBe(false)
  })

  test('rejects merged-content metadata tampering in a persisted preview', () => {
    const b = 'a\nb\nc\nd\ne\n'
    const w = 'a\nW\nc\nd\ne\n'
    const c = 'a\nb\nc\nC\ne\n'
    const preview = planThreeInputMerge(fixture([file('a.txt', b)], [file('a.txt', w)], [file('a.txt', c)],
      { baseline: { 'a.txt': b }, canonical: { 'a.txt': w }, candidate: { 'a.txt': c } }))
    const entry = preview.entries[0]!
    expect(MergePreviewSchema.safeParse({ ...preview, entries: [{ ...entry, merged_text: 'tampered' }] }).success).toBe(false)
    expect(MergePreviewSchema.safeParse({ ...preview, entries: [{ ...entry, result: { ...entry.result, size_bytes: 0 } }] }).success).toBe(false)
    expect(MergePreviewSchema.safeParse({ ...preview, entries: [{ ...entry, result: {
      path: 'a.txt', kind: 'directory', sha256: null, size_bytes: 0, mode: 0o755, symlink_target: null,
    } }] }).success).toBe(false)
  })

  test('rejects an inconsistent tree with a file used as a parent', () => {
    const invalid = fixture([file('src', 'file'), file('src/a.txt', 'child')], [], [])
    expect(() => planThreeInputMerge(invalid)).toThrow('MERGE_INVALID_TREE')
  })
})

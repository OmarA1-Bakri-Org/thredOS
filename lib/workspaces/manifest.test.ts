import { describe, expect, test } from 'bun:test'
import { createSnapshotManifest, verifySnapshotManifest } from './manifest'
import type { SnapshotEntry } from './schema'

describe('createSnapshotManifest', () => {
  test('sorts entries and produces a stable root hash independent of discovery order', () => {
    const entries: SnapshotEntry[] = [
      {
        path: 'src/index.ts',
        kind: 'file',
        sha256: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        size_bytes: 20,
        mode: 0o644,
        symlink_target: null,
      },
      {
        path: 'src',
        kind: 'directory',
        sha256: null,
        size_bytes: 0,
        mode: 0o755,
        symlink_target: null,
      },
      {
        path: 'README.md',
        kind: 'file',
        sha256: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        size_bytes: 10,
        mode: 0o644,
        symlink_target: null,
      },
      {
        path: 'src/index-link.ts',
        kind: 'symlink',
        sha256: null,
        size_bytes: 0,
        mode: 0o777,
        symlink_target: 'src/index.ts',
      },
    ]

    const first = createSnapshotManifest('snapshot-01', entries)
    const second = createSnapshotManifest('snapshot-01', [...entries].reverse())

    expect(first.entries.map(entry => entry.path)).toEqual([
      'README.md',
      'src',
      'src/index-link.ts',
      'src/index.ts',
    ])
    expect(first.root_manifest_hash).toBe(second.root_manifest_hash)
    expect(first.root_manifest_hash).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  test('changes the root hash when mode or symlink target changes', () => {
    const baseline = createSnapshotManifest('snapshot-01', [
      {
        path: 'bin/tool.sh',
        kind: 'file',
        sha256: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
        size_bytes: 30,
        mode: 0o755,
        symlink_target: null,
      },
      {
        path: 'src/link',
        kind: 'symlink',
        sha256: null,
        size_bytes: 0,
        mode: 0o777,
        symlink_target: '../bin/tool.sh',
      },
    ])

    const changedMode = createSnapshotManifest('snapshot-01', [
      {
        path: 'bin/tool.sh',
        kind: 'file',
        sha256: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
        size_bytes: 30,
        mode: 0o644,
        symlink_target: null,
      },
      {
        path: 'src/link',
        kind: 'symlink',
        sha256: null,
        size_bytes: 0,
        mode: 0o777,
        symlink_target: '../bin/tool.sh',
      },
    ])

    const changedLink = createSnapshotManifest('snapshot-01', [
      {
        path: 'bin/tool.sh',
        kind: 'file',
        sha256: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
        size_bytes: 30,
        mode: 0o755,
        symlink_target: null,
      },
      {
        path: 'src/link',
        kind: 'symlink',
        sha256: null,
        size_bytes: 0,
        mode: 0o777,
        symlink_target: '../bin/other.sh',
      },
    ])

    expect(changedMode.root_manifest_hash).not.toBe(baseline.root_manifest_hash)
    expect(changedLink.root_manifest_hash).not.toBe(baseline.root_manifest_hash)
  })

  test('accepts portable Unicode and bracketed paths, normalizes NFC, and sorts by UTF-8 bytes', () => {
    const manifest = createSnapshotManifest('snapshot-01', [
      {
        path: 'src/😀.ts',
        kind: 'file',
        sha256: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        size_bytes: 1,
        mode: 0o644,
        symlink_target: null,
      },
      {
        path: 'src/cafe\u0301/[attemptId].ts',
        kind: 'file',
        sha256: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        size_bytes: 1,
        mode: 0o644,
        symlink_target: null,
      },
      {
        path: 'src/z.ts',
        kind: 'file',
        sha256: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        size_bytes: 1,
        mode: 0o644,
        symlink_target: null,
      },
    ])

    expect(manifest.entries.map(entry => entry.path)).toEqual([
      'src/café/[attemptId].ts',
      'src/z.ts',
      'src/😀.ts',
    ])
  })

  test.each([
    '/absolute/file.txt',
    'src\\windows-path.ts',
    '../escape.txt',
    'src/../escape.txt',
    './src/index.ts',
    'src//double-slash.ts',
  ])('rejects non-canonical manifest path %s', invalidPath => {
    expect(() => createSnapshotManifest('snapshot-01', [{
      path: invalidPath,
      kind: 'file',
      sha256: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      size_bytes: 1,
      mode: 0o644,
      symlink_target: null,
    }])).toThrow()
  })

  test('rejects duplicate normalized manifest paths', () => {
    expect(() => createSnapshotManifest('snapshot-01', [
      {
        path: 'src/index.ts',
        kind: 'file',
        sha256: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        size_bytes: 1,
        mode: 0o644,
        symlink_target: null,
      },
      {
        path: 'src/index.ts',
        kind: 'file',
        sha256: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        size_bytes: 2,
        mode: 0o644,
        symlink_target: null,
      },
    ])).toThrow('Duplicate snapshot entry path')
  })

  test('rejects symlink targets that escape the snapshot root', () => {
    expect(() => createSnapshotManifest('snapshot-01', [
      {
        path: 'src/deep/link',
        kind: 'symlink',
        sha256: null,
        size_bytes: 0,
        mode: 0o777,
        symlink_target: '../../../outside.txt',
      },
    ])).toThrow('must not escape the snapshot root')
  })

  test('rejects aggregate byte counts that exceed safe integer precision', () => {
    expect(() => createSnapshotManifest('snapshot-01', [
      {
        path: 'large.bin',
        kind: 'file',
        sha256: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        size_bytes: Number.MAX_SAFE_INTEGER,
        mode: 0o644,
        symlink_target: null,
      },
      {
        path: 'small.bin',
        kind: 'file',
        sha256: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        size_bytes: 1,
        mode: 0o644,
        symlink_target: null,
      },
    ])).toThrow('total_bytes exceeds Number.MAX_SAFE_INTEGER')
  })
})

describe('verifySnapshotManifest', () => {
  test('recomputes counts and validates a canonical manifest', () => {
    const manifest = createSnapshotManifest('snapshot-01', [
      {
        path: 'README.md',
        kind: 'file',
        sha256: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        size_bytes: 10,
        mode: 0o644,
        symlink_target: null,
      },
      {
        path: 'src',
        kind: 'directory',
        sha256: null,
        size_bytes: 0,
        mode: 0o755,
        symlink_target: null,
      },
      {
        path: 'src/index.ts',
        kind: 'file',
        sha256: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        size_bytes: 22,
        mode: 0o644,
        symlink_target: null,
      },
      {
        path: 'src/index-link.ts',
        kind: 'symlink',
        sha256: null,
        size_bytes: 0,
        mode: 0o777,
        symlink_target: '../README.md',
      },
    ])

    expect(verifySnapshotManifest(manifest)).toEqual({
      rootManifestHash: manifest.root_manifest_hash,
      fileCount: 2,
      directoryCount: 1,
      symlinkCount: 1,
      totalBytes: 32,
    })
  })

  test('rejects root-hash tampering and unsorted entries', () => {
    const manifest = createSnapshotManifest('snapshot-01', [
      {
        path: 'a.txt',
        kind: 'file',
        sha256: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        size_bytes: 1,
        mode: 0o644,
        symlink_target: null,
      },
      {
        path: 'b.txt',
        kind: 'file',
        sha256: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        size_bytes: 2,
        mode: 0o644,
        symlink_target: null,
      },
    ])

    expect(() => verifySnapshotManifest({
      ...manifest,
      root_manifest_hash: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    })).toThrow('root manifest hash')

    expect(() => verifySnapshotManifest({
      ...manifest,
      entries: [...manifest.entries].reverse(),
    })).toThrow('sorted')
  })

  test('rejects persisted paths that are not NFC-normalized', () => {
    const manifest = createSnapshotManifest('snapshot-01', [{
      path: 'café.txt',
      kind: 'file',
      sha256: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      size_bytes: 1,
      mode: 0o644,
      symlink_target: null,
    }])

    expect(() => verifySnapshotManifest({
      ...manifest,
      entries: [{ ...manifest.entries[0]!, path: 'cafe\u0301.txt' }],
    })).toThrow('NFC-normalized')
  })
})

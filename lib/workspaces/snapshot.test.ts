import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, readdir, rename, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join, sep } from 'path'
import { createDefaultWorkspaceConfig } from './config-schema'
import { resolveWorkspaceRuntimePaths } from './paths'
import { captureSnapshot, SnapshotCaptureError, type SnapshotCaptureDependencies } from './snapshot'
import {
  setSafeIoAfterOpenHookForTests,
  setSafeIoBeforeOpenHookForTests,
} from '@/lib/security/safe-io'

const roots: string[] = []

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

async function makeProject(): Promise<string> {
  const root = await tempRoot('threados-snapshot-source-')
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'src', 'index.ts'), 'export const answer = 42\n')
  await writeFile(join(root, 'binary.bin'), Buffer.from([0, 255, 1, 128, 13, 10]))
  return root
}

function request(canonicalRoot: string, runtimeDataRoot: string) {
  return {
    canonicalRoot,
    runtimeDataRoot,
    localWorkspaceId: 'local-test',
    workflowRunId: 'run-test',
    config: createDefaultWorkspaceConfig(),
  }
}

afterEach(async () => {
  setSafeIoBeforeOpenHookForTests(null)
  setSafeIoAfterOpenHookForTests(null)
  await Promise.all(roots.splice(0).map(root => rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50,
  })))
})

describe('captureSnapshot', () => {
  test('captures bytes into an external content-addressed tree and persists ready evidence', async () => {
    const source = await makeProject()
    const runtime = await tempRoot('threados-snapshot-runtime-')

    const result = await captureSnapshot(request(source, runtime))

    expect(result.reused).toBe(false)
    expect(result.snapshot.status).toBe('ready')
    expect(result.snapshot.root_manifest_hash).toBe(result.manifest.root_manifest_hash)
    expect(result.snapshot.content_root?.startsWith(source)).toBe(false)
    expect(await readFile(join(result.snapshot.content_root!, 'binary.bin')))
      .toEqual(Buffer.from([0, 255, 1, 128, 13, 10]))
    expect(result.manifest.entries.map(entry => entry.path)).toEqual(['binary.bin', 'src', 'src/index.ts'])

    const sourceStat = await lstat(join(source, 'binary.bin'), { bigint: true })
    const copyStat = await lstat(join(result.snapshot.content_root!, 'binary.bin'), { bigint: true })
    if (sourceStat.dev === copyStat.dev) expect(sourceStat.ino).not.toBe(copyStat.ino)
    expect(Number(copyStat.mode) & 0o222).toBe(0)

    const stored = JSON.parse(await readFile(
      join(source, '.threados', 'snapshots', result.snapshot.id, 'manifest.json'),
      'utf8',
    ))
    expect(stored.root_manifest_hash).toBe(result.manifest.root_manifest_hash)
    const trace = await readFile(join(source, '.threados', 'runs', 'run-test', 'trace.ndjson'), 'utf8')
    expect(trace).toContain('snapshot-created')
  })

  test('never captures Git, thredOS, or nested runtime state', async () => {
    const source = await makeProject()
    const nestedRuntime = join(source, 'nested-runtime')
    const runtime = await tempRoot('threados-snapshot-runtime-')
    await mkdir(join(source, '.git'), { recursive: true })
    await writeFile(join(source, '.git', 'secret'), 'git metadata')
    await mkdir(join(source, '.threados'), { recursive: true })
    await writeFile(join(source, '.threados', 'secret'), 'runtime metadata')
    await mkdir(nestedRuntime, { recursive: true })
    await writeFile(join(nestedRuntime, 'secret'), 'nested runtime')

    const result = await captureSnapshot({
      ...request(source, runtime),
      alwaysExcludedRoots: [nestedRuntime],
    })
    const paths = result.manifest.entries.map(entry => entry.path)
    expect(paths.some(path => path === '.git' || path.startsWith('.git/'))).toBe(false)
    expect(paths.some(path => path === '.threados' || path.startsWith('.threados/'))).toBe(false)
    expect(paths.some(path => path === 'nested-runtime' || path.startsWith('nested-runtime/'))).toBe(false)
  })

  test('records executable mode where the host filesystem supports it', async () => {
    if (process.platform === 'win32') return
    const source = await makeProject()
    const runtime = await tempRoot('threados-snapshot-runtime-')
    await chmod(join(source, 'src', 'index.ts'), 0o755)

    const result = await captureSnapshot(request(source, runtime))
    const entry = result.manifest.entries.find(item => item.path === 'src/index.ts')
    expect(entry?.mode).not.toBeNull()
    expect((entry?.mode ?? 0) & 0o111).not.toBe(0)
  })

  test('retains safe relative symlink metadata and records escaping links without following them', async () => {
    const source = await makeProject()
    const runtime = await tempRoot('threados-snapshot-runtime-')
    const outside = await tempRoot('threados-snapshot-outside-')
    await writeFile(join(outside, 'secret.txt'), 'do not capture')
    try {
      await symlink('src/index.ts', join(source, 'internal-link'))
      await symlink(join(outside, 'secret.txt'), join(source, 'escaping-link'))
    } catch (error) {
      if (process.platform === 'win32' && error instanceof Error && 'code' in error && error.code === 'EPERM') return
      throw error
    }

    const result = await captureSnapshot(request(source, runtime))
    const internal = result.manifest.entries.find(entry => entry.path === 'internal-link')
    expect(internal).toMatchObject({ kind: 'symlink', symlink_target: 'src/index.ts' })
    expect(result.manifest.entries.some(entry => entry.path === 'escaping-link')).toBe(false)
    expect(result.snapshot.blocked_symlink_paths).toEqual(['escaping-link'])
    expect((await readlink(join(result.snapshot.content_root!, 'internal-link'))).replaceAll('\\', '/')).toBe('src/index.ts')
  })

  test('normalizes contained absolute links and preserves directory-link type', async () => {
    const source = await makeProject()
    const runtime = await tempRoot('threados-snapshot-runtime-')
    try {
      await symlink(join(source, 'src', 'index.ts'), join(source, 'absolute-link'))
      await symlink('src', join(source, 'directory-link'), 'dir')
    } catch (error) {
      if (process.platform === 'win32' && error instanceof Error && 'code' in error && error.code === 'EPERM') return
      throw error
    }

    const result = await captureSnapshot(request(source, runtime))
    expect(result.manifest.entries.find(entry => entry.path === 'absolute-link'))
      .toMatchObject({ kind: 'symlink', symlink_target: 'src/index.ts' })
    expect(result.manifest.entries.find(entry => entry.path === 'directory-link'))
      .toMatchObject({ kind: 'symlink', symlink_target: 'src' })
    expect((await lstat(join(result.snapshot.content_root!, 'directory-link'))).isSymbolicLink()).toBe(true)
  })

  test('retries source mutations raised during both discovery passes', async () => {
    for (const phase of ['before-copy', 'after-copy'] as const) {
      const source = await makeProject()
      const runtime = await tempRoot('threados-snapshot-runtime-')
      let mutated = false
      const result = await captureSnapshot(request(source, runtime), {
        beforeEntryStat: async context => {
          if (!mutated && context.phase === phase && context.path === 'src/index.ts') {
            mutated = true
            await rm(join(source, 'src', 'index.ts'))
          }
        },
      })

      expect(result.snapshot.source_retry_count).toBe(1)
      expect(result.manifest.entries.some(entry => entry.path === 'src/index.ts')).toBe(false)
    }
  })

  test('does not traverse a source directory swapped to an escaping junction', async () => {
    const source = await makeProject()
    const runtime = await tempRoot('threados-snapshot-runtime-')
    const outside = await tempRoot('threados-snapshot-outside-')
    await writeFile(join(outside, 'secret.txt'), 'outside secret')
    let swapped = false
    let restored = false

    try {
      const result = await captureSnapshot(request(source, runtime), {
        beforeEntryStat: async context => {
          if (!swapped && context.attempt === 1 && context.phase === 'before-copy' && context.path === 'src/index.ts') {
            await rename(join(source, 'src'), join(source, 'original-src'))
            await symlink(outside, join(source, 'src'), process.platform === 'win32' ? 'junction' : 'dir')
            swapped = true
          } else if (swapped && !restored && context.attempt === 2 && context.path === 'binary.bin') {
            await rm(join(source, 'src'), { recursive: true, force: true })
            await rename(join(source, 'original-src'), join(source, 'src'))
            restored = true
          }
        },
      })

      expect(result.snapshot.source_retry_count).toBe(2)
      expect(result.manifest.entries.some(entry => entry.path === 'src/secret.txt')).toBe(false)
      expect(result.manifest.entries.some(entry => entry.path === 'secret.txt')).toBe(false)
    } catch (error) {
      if (process.platform === 'win32' && error instanceof Error && 'code' in error && error.code === 'EPERM') return
      throw error
    }
  })

  test('retries the whole capture when source state changes and then succeeds', async () => {
    const source = await makeProject()
    const runtime = await tempRoot('threados-snapshot-runtime-')
    let attempts = 0
    const dependencies: SnapshotCaptureDependencies = {
      afterAttemptCopied: async () => {
        attempts += 1
        if (attempts === 1) await writeFile(join(source, 'src', 'index.ts'), 'export const answer = 43\n')
      },
    }

    const result = await captureSnapshot(request(source, runtime), dependencies)
    expect(result.snapshot.source_retry_count).toBe(1)
    expect(await readFile(join(result.snapshot.content_root!, 'src', 'index.ts'), 'utf8'))
      .toBe('export const answer = 43\n')
  })

  test('retries when a discovered file is swapped after safe open but before identity validation', async () => {
    const source = await makeProject()
    const runtime = await tempRoot('threados-snapshot-runtime-')
    const outside = await tempRoot('threados-snapshot-swap-backup-')
    const sourceFile = join(source, 'src', 'index.ts')
    let swapped = false
    setSafeIoAfterOpenHookForTests(async context => {
      if (swapped || context.operation !== 'copy-source' || context.filePath !== sourceFile) return
      swapped = true
      await rename(sourceFile, join(outside, 'original.ts'))
      await writeFile(sourceFile, 'replacement bytes\n')
    })

    const result = await captureSnapshot(request(source, runtime))

    expect(result.snapshot.source_retry_count).toBe(1)
    expect(await readFile(join(result.snapshot.content_root!, 'src', 'index.ts'), 'utf8'))
      .toBe('replacement bytes\n')
  })

  test('fails truthfully and removes partial staging when the source never stabilizes', async () => {
    const source = await makeProject()
    const runtime = await tempRoot('threados-snapshot-runtime-')
    const config = createDefaultWorkspaceConfig()
    config.snapshot.max_source_retries = 1
    let revision = 0

    await expect(captureSnapshot(
      { ...request(source, runtime), config },
      { afterAttemptCopied: async () => writeFile(join(source, 'src', 'index.ts'), `revision ${revision += 1}\n`) },
    )).rejects.toBeInstanceOf(SnapshotCaptureError)

    const namespaceEntries = await readdir(join(runtime, 'snapshots'), { recursive: true }).catch(() => [])
    expect(namespaceEntries.some(entry => String(entry).includes('.staging-'))).toBe(false)
    const trace = await readFile(join(source, '.threados', 'runs', 'run-test', 'trace.ndjson'), 'utf8')
    expect(trace).toContain('snapshot-failed')
  })

  test('reuses an identical verified snapshot and emits reuse evidence', async () => {
    const source = await makeProject()
    const runtime = await tempRoot('threados-snapshot-runtime-')
    const first = await captureSnapshot(request(source, runtime))
    const second = await captureSnapshot(request(source, runtime))

    expect(second.reused).toBe(true)
    expect(second.snapshot.id).toBe(first.snapshot.id)
    expect(second.snapshot.root_manifest_hash).toBe(first.snapshot.root_manifest_hash)
    const trace = await readFile(join(source, '.threados', 'runs', 'run-test', 'trace.ndjson'), 'utf8')
    expect(trace).toContain('snapshot-reused')
  })

  test('does not reuse a snapshot record across workflow-run scopes', async () => {
    const source = await makeProject()
    const runtime = await tempRoot('threados-snapshot-runtime-')
    const first = await captureSnapshot(request(source, runtime))
    const second = await captureSnapshot({
      ...request(source, runtime),
      workflowRunId: 'run-other',
    })

    expect(second.reused).toBe(false)
    expect(second.snapshot.id).not.toBe(first.snapshot.id)
    expect(second.snapshot.content_root).toBe(first.snapshot.content_root)
  })

  test('rejects a reusable record whose content root is outside its addressed cache path', async () => {
    const source = await makeProject()
    const runtime = await tempRoot('threados-snapshot-runtime-')
    const first = await captureSnapshot(request(source, runtime))
    const recordRoot = join(source, '.threados', 'snapshots', first.snapshot.id)
    const pointer = JSON.parse(await readFile(join(recordRoot, 'current.json'), 'utf8')) as { generation: string }
    const metadataPath = join(recordRoot, 'generations', pointer.generation, 'metadata.json')
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as Record<string, unknown>
    await writeFile(metadataPath, `${JSON.stringify({ ...metadata, content_root: source }, null, 2)}\n`)

    await expect(captureSnapshot(request(source, runtime)))
      .rejects.toMatchObject({ code: 'SNAPSHOT_STORAGE_CORRUPT' })
  })

  test('rejects a symlink-plus-parent alias in a reusable content root', async () => {
    const source = await makeProject()
    const runtime = await tempRoot('threados-snapshot-runtime-')
    const outside = await tempRoot('threados-snapshot-alias-target-')
    const first = await captureSnapshot(request(source, runtime))
    const digestRoot = dirname(first.snapshot.content_root!)
    try {
      await symlink(outside, join(digestRoot, 'alias'), process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      if (process.platform === 'win32' && error instanceof Error && 'code' in error && error.code === 'EPERM') return
      throw error
    }
    const poisonedRoot = `${digestRoot}${sep}alias${sep}..${sep}tree`
    const recordRoot = join(source, '.threados', 'snapshots', first.snapshot.id)
    const pointer = JSON.parse(await readFile(join(recordRoot, 'current.json'), 'utf8')) as { generation: string }
    const metadataPath = join(recordRoot, 'generations', pointer.generation, 'metadata.json')
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as Record<string, unknown>
    await writeFile(metadataPath, `${JSON.stringify({ ...metadata, content_root: poisonedRoot }, null, 2)}\n`)

    await expect(captureSnapshot(request(source, runtime)))
      .rejects.toMatchObject({ code: 'SNAPSHOT_STORAGE_CORRUPT' })
  })

  test('rejects a poisoned runtime namespace before writing outside the runtime root', async () => {
    const source = await makeProject()
    const runtime = await tempRoot('threados-snapshot-runtime-')
    const outside = await tempRoot('threados-snapshot-poison-target-')
    const paths = resolveWorkspaceRuntimePaths(runtime, 'local-test', source)
    await mkdir(join(runtime, 'snapshots'), { recursive: true })
    try {
      await symlink(
        outside,
        join(runtime, 'snapshots', paths.workspaceNamespace),
        process.platform === 'win32' ? 'junction' : 'dir',
      )
    } catch (error) {
      if (process.platform === 'win32' && error instanceof Error && 'code' in error && error.code === 'EPERM') return
      throw error
    }

    await expect(captureSnapshot(request(source, runtime)))
      .rejects.toMatchObject({ code: 'SNAPSHOT_UNSAFE_PATH' })
    expect(await readdir(outside)).toEqual([])
  })

  test('rejects a relative runtime data root', async () => {
    const source = await makeProject()

    await expect(captureSnapshot(request(source, 'relative-runtime-root')))
      .rejects.toMatchObject({ code: 'SNAPSHOT_UNSAFE_PATH' })
  })

  test('enforces capture byte quotas before copying', async () => {
    const source = await makeProject()
    const runtime = await tempRoot('threados-snapshot-runtime-')
    const config = createDefaultWorkspaceConfig()
    config.workspace.max_bytes_each = 3
    config.workspace.max_total_retained_bytes = 3

    await expect(captureSnapshot({ ...request(source, runtime), config }))
      .rejects.toMatchObject({ code: 'SNAPSHOT_QUOTA_EXCEEDED' })
  })

  test('keeps the committed snapshot truthful when its trace projection fails', async () => {
    const source = await makeProject()
    const runtime = await tempRoot('threados-snapshot-runtime-')
    const result = await captureSnapshot(request(source, runtime), {
      appendTrace: async () => { throw new Error('injected trace failure') },
    })

    expect(result.snapshot.status).toBe('ready')
    expect(result.evidence).toEqual({
      commit_status: 'committed',
      trace_status: 'failed',
      warning_code: 'SNAPSHOT_TRACE_PERSIST_FAILED',
      warning: 'Snapshot committed, but snapshot trace projection persistence failed.',
    })
    expect(JSON.parse(await readFile(
      join(source, '.threados', 'snapshots', result.snapshot.id, 'current.json'),
      'utf8',
    ))).toHaveProperty('generation')
  })

  test('surfaces missing trace evidence when a failed capture is committed', async () => {
    const source = await makeProject()
    const runtime = await tempRoot('threados-snapshot-runtime-')
    const config = createDefaultWorkspaceConfig()
    config.snapshot.max_source_retries = 0

    try {
      await captureSnapshot(
        { ...request(source, runtime), config },
        {
          afterAttemptCopied: async () => writeFile(join(source, 'src', 'index.ts'), 'changed\n'),
          appendTrace: async () => { throw new Error('injected trace failure') },
        },
      )
      throw new Error('capture unexpectedly succeeded')
    } catch (error) {
      expect(error).toBeInstanceOf(SnapshotCaptureError)
      expect((error as SnapshotCaptureError).code).toBe('SNAPSHOT_SOURCE_BUSY')
      expect((error as SnapshotCaptureError).evidence).toMatchObject({
        commit_status: 'committed',
        trace_status: 'failed',
        warning_code: 'SNAPSHOT_TRACE_PERSIST_FAILED',
      })
    }
  })
})

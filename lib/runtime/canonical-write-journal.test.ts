import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { SnapshotEntry } from '../workspaces/schema'
import {
  CanonicalPreconditionSchema,
  beginCanonicalProjectWrite,
  classifyCanonicalManifestChange,
  commitCanonicalProjectWrite,
  readCanonicalPrecondition,
  readCanonicalProjectWrites,
} from './canonical-write-journal'

const roots: string[] = []
const NOW = '2026-09-28T00:00:00.000Z'
const BEFORE_HASH = `sha256:${'a'.repeat(64)}`

function entry(sha: string): SnapshotEntry {
  return {
    path: 'source.txt',
    kind: 'file',
    sha256: `sha256:${sha.repeat(64)}`,
    size_bytes: 6,
    mode: 0o644,
    symlink_target: null,
  }
}

async function fixture(): Promise<string> {
  const basePath = await mkdtemp(join(tmpdir(), 'threados-canonical-journal-'))
  roots.push(basePath)
  const runRoot = join(basePath, '.threados', 'runs', 'run-1')
  await mkdir(runRoot, { recursive: true })
  await writeFile(join(runRoot, 'canonical-precondition.json'), `${JSON.stringify(
    CanonicalPreconditionSchema.parse({
      schema_version: 1,
      revision: 0,
      workflow_run_id: 'run-1',
      snapshot_id: 'snapshot-1',
      pre_hash: BEFORE_HASH,
      captured_at: NOW,
      threados_project_write_refs: [],
    }),
    null,
    2,
  )}\n`)
  return basePath
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('canonical project write attribution', () => {
  test('persists a path and manifest-bound write before classifying thredOS mutation', async () => {
    const basePath = await fixture()
    const before = entry('1')
    const after = entry('2')
    const planned = await beginCanonicalProjectWrite({
      basePath,
      workflowRunId: 'run-1',
      owner: 'runtime-test',
      operation: 'modify',
      path: before.path,
      beforeEntry: before,
      now: () => NOW,
      createId: () => 'one',
    })
    const condition = await readCanonicalPrecondition(basePath, 'run-1')
    expect(condition.revision).toBe(1)
    expect(condition.threados_project_write_refs).toEqual([
      '.threados/runs/run-1/canonical-writes/canonical-write-one.json',
    ])

    const committed = await commitCanonicalProjectWrite({
      basePath,
      record: planned,
      afterEntry: after,
      now: () => NOW,
    })
    const writes = await readCanonicalProjectWrites(
      basePath,
      'run-1',
      condition.threados_project_write_refs,
    )
    expect(writes).toEqual([committed])
    expect(classifyCanonicalManifestChange({ before: [before], after: [after], writes }))
      .toBe('threados_mutation')
  })

  test('allows unjournaled external edits and fails closed on incomplete or tampered attribution', async () => {
    const basePath = await fixture()
    const before = entry('1')
    const after = entry('2')
    expect(classifyCanonicalManifestChange({ before: [before], after: [after], writes: [] }))
      .toBe('external_user_edit')

    const planned = await beginCanonicalProjectWrite({
      basePath,
      workflowRunId: 'run-1',
      owner: 'runtime-test',
      operation: 'modify',
      path: before.path,
      beforeEntry: before,
      now: () => NOW,
      createId: () => 'two',
    })
    expect(() => classifyCanonicalManifestChange({ before: [before], after: [after], writes: [planned] }))
      .toThrow('lacks committed evidence')

    const recordPath = join(
      basePath,
      '.threados',
      'runs',
      'run-1',
      'canonical-writes',
      'canonical-write-two.json',
    )
    const raw = JSON.parse(await readFile(recordPath, 'utf8')) as Record<string, unknown>
    await writeFile(recordPath, JSON.stringify({ ...raw, path: '../escape' }))
    const refs = (await readCanonicalPrecondition(basePath, 'run-1')).threados_project_write_refs
    await expect(readCanonicalProjectWrites(basePath, 'run-1', refs)).rejects.toMatchObject({
      code: 'CANONICAL_WORKSPACE_MUTATED',
    })
    await unlink(recordPath)
    await expect(readCanonicalProjectWrites(basePath, 'run-1', refs)).rejects.toMatchObject({
      code: 'CANONICAL_WORKSPACE_MUTATED',
    })
  })
})

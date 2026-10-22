import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'crypto'
import { readdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { createPr11Fixture, readCanonicalEvidence, type Pr11Fixture } from './pr11-workspace-test-helper'
import { SnapshotRepository } from '@/lib/workspaces/snapshot-repository'
import {
  beginCanonicalProjectWrite,
  commitCanonicalProjectWrite,
} from '@/lib/runtime/canonical-write-journal'

let fixture: Pr11Fixture | null = null
afterEach(async () => { await fixture?.cleanup(); fixture = null })

describe('PR-11 canonical workspace protection', () => {
  test('canonical project bytes remain unchanged without an external edit', async () => {
    fixture = await createPr11Fixture(['write-one'])
    const before = await readFile(join(fixture.canonical, 'source.txt'))
    const outcome = await fixture.run()
    const after = await readFile(join(fixture.canonical, 'source.txt'))
    const evidence = await readCanonicalEvidence(fixture.canonical, outcome.run.id, outcome.attempts[0]!.id)

    expect(after.equals(before)).toBe(true)
    expect(evidence).toMatchObject({ classification: 'unchanged' })
    expect(evidence.pre_hash).toBe(evidence.post_hash)
  }, 30_000)

  test('an external user edit survives and is recorded as a changed precondition', async () => {
    let durablePrecondition: Record<string, unknown> | null = null
    fixture = await createPr11Fixture(['write-one'], async canonical => {
      const [runId] = await readdir(join(canonical, '.threados', 'runs'))
      durablePrecondition = JSON.parse(await readFile(join(
        canonical,
        '.threados',
        'runs',
        runId!,
        'canonical-precondition.json',
      ), 'utf8'))
      await writeFile(join(canonical, 'user-edit.txt'), 'external edit\n')
    })
    const outcome = await fixture.run()
    const evidence = await readCanonicalEvidence(fixture.canonical, outcome.run.id, outcome.attempts[0]!.id)

    expect(await readFile(join(fixture.canonical, 'user-edit.txt'), 'utf8')).toBe('external edit\n')
    expect(durablePrecondition).toMatchObject({
      schema_version: 1,
      workflow_run_id: outcome.run.id,
      snapshot_id: outcome.run.baseline_snapshot_id,
      threados_project_write_refs: [],
    })
    expect(evidence.classification).toBe('external_user_edit')
    expect(evidence.pre_hash).not.toBe(evidence.post_hash)
    expect(outcome.run).toMatchObject({
      status: 'successful',
      error_code: null,
    })
  }, 30_000)

  test('a journaled thredOS write fails closed while preserving mixed user edits', async () => {
    fixture = await createPr11Fixture(['write-one'], async canonical => {
      const [runId] = await readdir(join(canonical, '.threados', 'runs'))
      const precondition = JSON.parse(await readFile(join(
        canonical,
        '.threados',
        'runs',
        runId!,
        'canonical-precondition.json',
      ), 'utf8')) as { snapshot_id: string }
      const manifest = await new SnapshotRepository(canonical).getManifest(precondition.snapshot_id)
      const before = manifest?.entries.find(entry => entry.path === 'source.txt')
      if (!before) throw new Error('source baseline entry is missing')
      const planned = await beginCanonicalProjectWrite({
        basePath: canonical,
        workflowRunId: runId!,
        owner: 'runtime-test',
        operation: 'modify',
        path: 'source.txt',
        beforeEntry: before,
        createId: () => 'tracked',
      })
      const content = 'runtime mutation\n'
      await writeFile(join(canonical, 'source.txt'), content)
      await writeFile(join(canonical, 'user-edit.txt'), 'external edit survives\n')
      await commitCanonicalProjectWrite({
        basePath: canonical,
        record: planned,
        afterEntry: {
          ...before,
          sha256: `sha256:${createHash('sha256').update(content).digest('hex')}`,
          size_bytes: Buffer.byteLength(content),
        },
      })
    })

    const outcome = await fixture.run()
    expect(await readFile(join(fixture.canonical, 'source.txt'), 'utf8')).toBe('runtime mutation\n')
    expect(await readFile(join(fixture.canonical, 'user-edit.txt'), 'utf8')).toBe('external edit survives\n')
    expect(outcome.run).toMatchObject({
      status: 'failed',
      error_code: 'CANONICAL_WORKSPACE_MUTATED',
    })
  }, 30_000)

  test('tampered canonical-write attribution fails closed', async () => {
    fixture = await createPr11Fixture(['write-one'], async canonical => {
      const [runId] = await readdir(join(canonical, '.threados', 'runs'))
      const precondition = JSON.parse(await readFile(join(
        canonical,
        '.threados',
        'runs',
        runId!,
        'canonical-precondition.json',
      ), 'utf8')) as { snapshot_id: string }
      const manifest = await new SnapshotRepository(canonical).getManifest(precondition.snapshot_id)
      const before = manifest?.entries.find(entry => entry.path === 'source.txt')
      if (!before) throw new Error('source baseline entry is missing')
      const planned = await beginCanonicalProjectWrite({
        basePath: canonical,
        workflowRunId: runId!,
        owner: 'runtime-test',
        operation: 'modify',
        path: 'source.txt',
        beforeEntry: before,
        createId: () => 'tampered',
      })
      const content = 'runtime mutation\n'
      await writeFile(join(canonical, 'source.txt'), content)
      const committed = await commitCanonicalProjectWrite({
        basePath: canonical,
        record: planned,
        afterEntry: {
          ...before,
          sha256: `sha256:${createHash('sha256').update(content).digest('hex')}`,
          size_bytes: Buffer.byteLength(content),
        },
      })
      await writeFile(join(
        canonical,
        '.threados',
        'runs',
        runId!,
        'canonical-writes',
        `${committed.id}.json`,
      ), JSON.stringify({ ...committed, after_entry_hash: `sha256:${'f'.repeat(64)}` }))
    })

    const outcome = await fixture.run()
    expect(outcome.run).toMatchObject({
      status: 'failed',
      error_code: 'CANONICAL_WORKSPACE_MUTATED',
    })
  }, 30_000)
})

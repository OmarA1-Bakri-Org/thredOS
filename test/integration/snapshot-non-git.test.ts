import { afterEach, describe, expect, test } from 'bun:test'
import { cp, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { createDefaultWorkspaceConfig } from '@/lib/workspaces/config-schema'
import { captureSnapshot } from '@/lib/workspaces/snapshot'
import { createFixtureRoot, removeFixtureTree } from '../helpers/remove-fixture-tree'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(removeFixtureTree))
})

describe('snapshot non-Git integration', () => {
  test('captures a non-Git fixture by content without requiring Git', async () => {
    const source = await createFixtureRoot('threados-non-git-source-')
    const runtime = await createFixtureRoot('threados-non-git-runtime-')
    roots.push(source, runtime)
    await cp(join(import.meta.dir, '..', 'fixtures', 'workspaces', 'snapshot-project'), source, { recursive: true })
    await writeFile(join(source, 'untracked-by-definition.txt'), 'non-git content\n')

    const result = await captureSnapshot({
      canonicalRoot: source,
      runtimeDataRoot: runtime,
      localWorkspaceId: 'non-git-fixture',
      workflowRunId: 'run-non-git',
      config: createDefaultWorkspaceConfig(),
    })

    expect(result.snapshot.git_head).toBeNull()
    expect(result.snapshot.git_dirty).toBeNull()
    expect(await readFile(join(result.snapshot.content_root!, 'untracked-by-definition.txt'), 'utf8'))
      .toBe('non-git content\n')
  })
})

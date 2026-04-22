import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadPack } from './loader'
import { compilePack } from './compiler'
import { installPack } from './install'
import { readSequence, writeSequence } from '@/lib/sequence/parser'
import { readThreadSurfaceState } from '@/lib/thread-surfaces/repository'

const repoBase = '/mnt/c/Users/albak/xdev/thredOS-worktrees/apollo-pack'
const packRelativeDir = '.threados/packs/apollo-segment-builder/1.0.0'
const promptDir = '.threados/prompts'
const sharedReferencesDir = 'shared_references'

let basePath: string

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), 'threados-apollo-pack-'))
  await mkdir(join(basePath, '.threados'), { recursive: true })
})

afterEach(async () => {
  await rm(basePath, { recursive: true, force: true })
})

describe('apollo segment builder pack', () => {
  test('repo pack has all referenced prompt and shared-reference assets', async () => {
    const manifest = await loadPack(repoBase, 'apollo-segment-builder', '1.0.0')

    for (const reference of manifest.shared_references) {
      await expect(Bun.file(join(repoBase, reference.path)).exists()).resolves.toBe(true)
    }

    for (const step of manifest.steps) {
      expect(step.prompt_file).toBeTruthy()
      await expect(Bun.file(join(repoBase, step.prompt_file!)).exists()).resolves.toBe(true)
    }
  })

  test('loads, compiles, and installs the real Apollo pack with gates and execution metadata', async () => {
    await cp(join(repoBase, packRelativeDir), join(basePath, packRelativeDir), { recursive: true })
    await cp(join(repoBase, promptDir), join(basePath, promptDir), { recursive: true })
    await cp(join(repoBase, sharedReferencesDir), join(basePath, sharedReferencesDir), { recursive: true })

    await writeSequence(basePath, {
      version: '1.0',
      name: 'Seed Sequence',
      steps: [{
        id: 'seed-step',
        name: 'Seed Step',
        type: 'base',
        model: 'claude-code',
        prompt_file: '.threados/prompts/seed-step.md',
        depends_on: [],
        status: 'READY',
      }],
      gates: [],
    } as any)
    await writeFile(join(basePath, '.threados/prompts/seed-step.md'), 'seed\n', 'utf-8')

    const manifest = await loadPack(basePath, 'apollo-segment-builder', '1.0.0')
    expect(manifest.steps).toHaveLength(20)
    expect(manifest.gates).toHaveLength(22)
    expect(manifest.shared_references).toHaveLength(7)

    const compiled = compilePack(manifest, { policyMode: 'SAFE' })
    expect(compiled.sequence.steps).toHaveLength(20)
    expect(compiled.sequence.gates).toHaveLength(22)
    expect(compiled.sequence.steps[0].execution).toBe('sequential')
    expect(compiled.sequence.steps[0].actions).toHaveLength(2)
    expect(compiled.sequence.steps[0].side_effect_class).toBe('execute')

    const result = await installPack(basePath, {
      packId: 'apollo-segment-builder',
      version: '1.0.0',
      installName: 'Apollo Segment Builder',
      compileOverrides: { policyMode: 'SAFE' },
    })

    expect(result.installedPack.stepCount).toBe(20)
    expect(result.installedPack.surfaceCount).toBe(21)

    const sequence = await readSequence(basePath)
    expect(sequence.pack_id).toBe('apollo-segment-builder')
    expect(sequence.pack_version).toBe('1.0.0')
    expect(sequence.steps).toHaveLength(20)
    expect(sequence.gates).toHaveLength(22)
    expect(sequence.steps[0].execution).toBe('sequential')
    expect(sequence.steps[0].actions).toHaveLength(2)
    expect(sequence.steps[0].timeout_ms).toBe(30000)

    const surfaceState = await readThreadSurfaceState(basePath)
    expect(surfaceState.threadSurfaces).toHaveLength(21)
  })
})

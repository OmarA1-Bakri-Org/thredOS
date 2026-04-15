import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import YAML from 'yaml'
import { readLibraryCatalog } from '../library/repository'
import { writePrompt, validatePromptExists, readPrompt } from '../prompts/manager'
import { readSequence, writeSequence } from '../sequence/parser'
import { readThreadSurfaceState } from '../thread-surfaces/repository'
const { installPack } = await import('./install.ts?pack-install-suite')

let basePath: string

const VALID_PACK = {
  id: 'demo-pack',
  version: '1.0.0',
  name: 'Demo Pack',
  thread_types: ['base'],
  default_policy: 'SAFE',
  agents: [],
  surface_classes: ['shared', 'sealed'],
  phases: [{ id: 'phase-alpha', label: 'Alpha', order: 0 }],
  steps: [
    {
      id: 'alpha',
      name: 'Alpha Step',
      type: 'base',
      model: 'claude-code',
      phase: 'phase-alpha',
      surface_class: 'shared',
      depends_on: [],
    },
    {
      id: 'beta',
      name: 'Beta Step',
      type: 'p',
      model: 'gpt-4o',
      phase: 'phase-alpha',
      surface_class: 'sealed',
      depends_on: ['alpha'],
    },
  ],
  gate_sets: [],
}

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), 'threados-pack-install-'))
  await mkdir(join(basePath, '.threados', 'packs', 'demo-pack', '1.0.0'), { recursive: true })
  await writeFile(join(basePath, '.threados', 'packs', 'demo-pack', '1.0.0', 'pack.yaml'), YAML.stringify(VALID_PACK), 'utf-8')
  await writeSequence(basePath, {
    version: '1.0',
    name: 'Old Sequence',
    steps: [{
      id: 'old-step',
      name: 'Old Step',
      type: 'base',
      model: 'claude-code',
      prompt_file: '.threados/prompts/old-step.md',
      depends_on: [],
      status: 'READY',
    }],
    gates: [],
  } as any)
  await writePrompt(basePath, 'old-step', '# Old Step\n\nlegacy prompt\n')
})

afterEach(async () => {
  await rm(basePath, { recursive: true, force: true })
})

describe('installPack', () => {
  test('compiles a pack into active sequence, surfaces, and prompt assets', async () => {
    const result = await installPack(basePath, {
      packId: 'demo-pack',
      version: '1.0.0',
      installName: 'Installed Demo',
      compileOverrides: {
        policyMode: 'POWER',
        modelOverrides: { alpha: 'gpt-5.4' },
      },
    })

    expect(result.installedPack).toEqual({
      packId: 'demo-pack',
      version: '1.0.0',
      stepCount: 2,
      surfaceCount: 3,
    })

    const sequence = await readSequence(basePath)
    expect(sequence.name).toBe('Installed Demo')
    expect(sequence.pack_id).toBe('demo-pack')
    expect(sequence.pack_version).toBe('1.0.0')
    expect(sequence.default_policy_ref).toBe('POWER')
    expect(sequence.steps.map(step => step.id)).toEqual(['alpha', 'beta'])
    expect(sequence.steps[0].model).toBe('gpt-5.4')
    expect(sequence.steps[0].prompt_ref?.path).toBe('.threados/prompts/alpha.md')

    const surfaces = await readThreadSurfaceState(basePath)
    expect(surfaces.threadSurfaces.map(surface => surface.id)).toEqual(['thread-root', 'thread-alpha', 'thread-beta'])

    expect(await validatePromptExists(basePath, 'alpha')).toBe(true)
    expect(await validatePromptExists(basePath, 'beta')).toBe(true)
    expect(await validatePromptExists(basePath, 'old-step')).toBe(false)
    expect(await readPrompt(basePath, 'alpha')).toContain('Pack: Demo Pack (demo-pack@1.0.0)')

    const catalog = await readLibraryCatalog(basePath)
    expect(catalog.prompts.alpha?.path).toBe('.threados/prompts/alpha.md')
    expect(catalog.prompts.beta?.path).toBe('.threados/prompts/beta.md')
    expect(catalog.prompts['old-step']).toBeUndefined()
  })
})

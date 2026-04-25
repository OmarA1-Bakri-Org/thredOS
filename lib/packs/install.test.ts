import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import YAML from 'yaml'
import { readLibraryCatalog } from '../library/repository'
import { writePrompt, validatePromptExists, readPrompt } from '../prompts/manager'
import { readSequence, writeSequence } from '../sequence/parser'
import type { Sequence } from '../sequence/schema'
import { readThreadSurfaceState } from '../thread-surfaces/repository'
// @ts-expect-error Bun query import used to isolate module cache in tests
const { installPack } = await import('./install.ts?pack-install-suite') as { installPack: typeof import('./install').installPack }

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
      execution: 'sequential',
      timeout_ms: 30000,
      actions: [{ id: 'run-alpha', type: 'cli', config: { command: 'echo alpha' }, on_failure: 'warn' }],
      prompt_file: 'prompts/alpha-authored.md',
      surface_class: 'shared',
      depends_on: [],
    },
    {
      id: 'beta',
      name: 'Beta Step',
      type: 'p',
      model: 'gpt-4o',
      phase: 'phase-alpha',
      execution: 'sub_agent',
      actions: [{ id: 'delegate-beta', type: 'sub_agent', config: { prompt: 'Do beta', subagent_type: 'researcher' }, on_failure: 'abort_workflow' }],
      surface_class: 'sealed',
      depends_on: ['alpha'],
    },
  ],
  gates: [
    {
      id: 'alpha-ready',
      step_id: 'alpha',
      when: 'post',
      type: 'hard',
      check: 'alpha.success == true',
      on_fail: 'abort',
      message: 'Alpha must succeed',
    },
  ],
  gate_sets: ['default-gates'],
  goal: 'Build a reviewable sponsor-prospect segment',
  success_criteria: ['qualified_segment.total_qualified > 0'],
  strategy_options: [
    {
      id: 'standard-discovery',
      label: 'Standard discovery',
      applies_to: ['beta'],
      selects_steps: ['beta'],
      suppresses_steps: [],
      requires_approval: false,
    },
  ],
  replan_policy: {
    enabled: true,
    triggers: ['empty_artifact', 'sparse_results'],
  },
}

const AUTHORED_ALPHA_PROMPT = '# Alpha Authored Prompt\n\nUse the canonical authored instructions.\n'

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), 'threados-pack-install-'))
  await mkdir(join(basePath, '.threados', 'packs', 'demo-pack', '1.0.0', 'prompts'), { recursive: true })
  await writeFile(join(basePath, '.threados', 'packs', 'demo-pack', '1.0.0', 'pack.yaml'), YAML.stringify(VALID_PACK), 'utf-8')
  await writeFile(join(basePath, '.threados', 'packs', 'demo-pack', '1.0.0', 'prompts', 'alpha-authored.md'), AUTHORED_ALPHA_PROMPT, 'utf-8')
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
  } as Sequence)
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
    expect(sequence.goal).toBe('Build a reviewable sponsor-prospect segment')
    expect(sequence.success_criteria).toEqual(['qualified_segment.total_qualified > 0'])
    expect(sequence.strategy_options).toEqual([
      {
        id: 'standard-discovery',
        label: 'Standard discovery',
        applies_to: ['beta'],
        selects_steps: ['beta'],
        suppresses_steps: [],
        requires_approval: false,
      },
    ])
    expect(sequence.replan_policy).toEqual({
      enabled: true,
      triggers: ['empty_artifact', 'sparse_results'],
    })
    expect(sequence.steps.map(step => step.id)).toEqual(['alpha', 'beta'])
    expect(sequence.steps[0].model).toBe('gpt-5.4')
    expect(sequence.steps[0].prompt_ref?.path).toBe('.threados/prompts/alpha.md')
    expect(sequence.steps[0].timeout_ms).toBe(30000)
    expect(sequence.steps[0].execution).toBe('sequential')
    expect(sequence.steps[0].actions).toHaveLength(1)
    expect(sequence.steps[0].gate_set_ref).toBe('default-gates')
    expect(sequence.steps[0].side_effect_class).toBe('execute')
    expect(sequence.gates).toEqual([
      {
        id: 'alpha-ready',
        name: 'alpha-ready',
        depends_on: ['alpha'],
        status: 'PENDING',
        cascade: false,
        childGateIds: [],
        description: 'Alpha must succeed',
        acceptance_conditions: ['alpha.success == true'],
        required_review: false,
      },
    ])

    const surfaces = await readThreadSurfaceState(basePath)
    expect(new Set(surfaces.threadSurfaces.map(surface => surface.id))).toEqual(new Set(['thread-root', 'thread-alpha', 'thread-beta']))

    expect(await validatePromptExists(basePath, 'alpha')).toBe(true)
    expect(await validatePromptExists(basePath, 'beta')).toBe(true)
    expect(await validatePromptExists(basePath, 'old-step')).toBe(false)
    expect(await readPrompt(basePath, 'alpha')).toBe(AUTHORED_ALPHA_PROMPT)
    expect(await readPrompt(basePath, 'beta')).toContain('Pack: Demo Pack (demo-pack@1.0.0)')

    const catalog = await readLibraryCatalog(basePath)
    expect(catalog.prompts.alpha?.path).toBe('.threados/prompts/alpha.md')
    expect(catalog.prompts.beta?.path).toBe('.threados/prompts/beta.md')
    expect(catalog.prompts['old-step']).toBeUndefined()
  })

  test('reinstalls authored prompt content deterministically after installed prompt drift', async () => {
    await installPack(basePath, {
      packId: 'demo-pack',
      version: '1.0.0',
    })

    await writePrompt(basePath, 'alpha', '# Drifted Installed Prompt\n\nmanual edits\n')
    expect(await readPrompt(basePath, 'alpha')).toContain('Drifted Installed Prompt')

    await installPack(basePath, {
      packId: 'demo-pack',
      version: '1.0.0',
    })

    expect(await readPrompt(basePath, 'alpha')).toBe(AUTHORED_ALPHA_PROMPT)
  })
})

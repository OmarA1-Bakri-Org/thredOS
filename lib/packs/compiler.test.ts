import { describe, expect, test } from 'bun:test'
import { compilePack } from './compiler'
import type { PackManifest } from './pack-schema'

const makeManifest = (overrides: Partial<PackManifest> = {}): PackManifest => ({
  id: 'my-pack',
  version: '2.0.0',
  name: 'My Pack',
  thread_types: ['base', 'p'],
  default_policy: 'SAFE',
  agents: [],
  surface_classes: ['shared', 'sealed'],
  phases: [
    { id: 'phase-1', label: 'Phase One', order: 0 },
    { id: 'phase-2', label: 'Phase Two', order: 1 },
  ],
  steps: [
    {
      id: 'alpha',
      name: 'Alpha Step',
      type: 'base',
      model: 'gpt-4o',
      phase: 'phase-1',
      execution: 'sequential',
      timeout_ms: 30000,
      condition: 'first_run == true',
      actions: [
        {
          id: 'run-alpha',
          type: 'cli',
          description: 'Run alpha',
          config: { command: 'echo alpha' },
          output_key: 'alpha_result',
          on_failure: 'warn',
        },
      ],
      surface_class: 'shared',
      depends_on: [],
    },
    {
      id: 'beta',
      name: 'Beta Step',
      type: 'p',
      model: 'gpt-4o',
      phase: 'phase-2',
      execution: 'sub_agent',
      actions: [
        {
          id: 'delegate-beta',
          type: 'sub_agent',
          config: { prompt: 'Do beta', subagent_type: 'researcher' },
          on_failure: 'abort_workflow',
        },
      ],
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
      check: 'alpha_result.success == true',
      on_fail: 'abort',
      message: 'Alpha must succeed before beta',
    },
  ],
  gate_sets: ['default-gates'],
  ...overrides,
})

describe('compilePack', () => {
  test('produces a valid sequence with correct name, pack_id, pack_version', () => {
    const result = compilePack(makeManifest())
    expect(result.sequence.name).toBe('My Pack')
    expect(result.sequence.pack_id).toBe('my-pack')
    expect(result.sequence.pack_version).toBe('2.0.0')
    expect(result.sequence.version).toBe('1.0')
    expect(result.sequence.thread_type).toBe('base')
    expect(result.sequence.gates).toEqual([
      {
        id: 'alpha-ready',
        name: 'alpha-ready',
        depends_on: ['alpha'],
        status: 'PENDING',
        cascade: false,
        childGateIds: [],
        description: 'Alpha must succeed before beta',
        acceptance_conditions: ['alpha_result.success == true'],
        required_review: false,
      },
    ])
    expect(result.sequence.default_policy_ref).toBe('policy:SAFE')
  })

  test('propagates step execution metadata into the compiled sequence', () => {
    const result = compilePack(makeManifest())
    const alphaStep = result.sequence.steps.find(s => s.id === 'alpha')!
    const betaStep = result.sequence.steps.find(s => s.id === 'beta')!

    expect(alphaStep.timeout_ms).toBe(30000)
    expect(alphaStep.gate_set_ref).toBe('default-gates')
    expect(alphaStep.side_effect_class).toBe('execute')
    expect((alphaStep as any).execution).toBe('sequential')
    expect((alphaStep as any).condition).toBe('first_run == true')
    expect((alphaStep as any).actions).toEqual([
      {
        id: 'run-alpha',
        type: 'cli',
        description: 'Run alpha',
        config: { command: 'echo alpha' },
        output_key: 'alpha_result',
        on_failure: 'warn',
      },
    ])

    expect(betaStep.side_effect_class).toBe('execute')
    expect((betaStep as any).execution).toBe('sub_agent')
    expect((betaStep as any).actions).toEqual([
      {
        id: 'delegate-beta',
        type: 'sub_agent',
        config: { prompt: 'Do beta', subagent_type: 'researcher' },
        on_failure: 'abort_workflow',
      },
    ])
  })

  test('produces surfaces for each step (root + N step surfaces)', () => {
    const result = compilePack(makeManifest())
    // root + 2 steps = 3 surfaces
    expect(result.surfaces).toHaveLength(3)
    expect(result.surfaces[0].id).toBe('thread-root')
    expect(result.surfaces[1].id).toBe('thread-alpha')
    expect(result.surfaces[2].id).toBe('thread-beta')
  })

  test('control surface has surfaceClass="control"', () => {
    const result = compilePack(makeManifest())
    const root = result.surfaces[0]
    expect(root.surfaceClass).toBe('control')
    expect(root.role).toBe('orchestrator')
    expect(root.depth).toBe(0)
    expect(root.parentSurfaceId).toBeNull()
    expect(root.childSurfaceIds).toEqual(['thread-alpha', 'thread-beta'])
  })

  test('sealed steps get surfaceClass="sealed", visibility="self_only", isolationLabel="THREADOS_SCOPED", revealState="sealed"', () => {
    const result = compilePack(makeManifest())
    const betaSurface = result.surfaces.find(s => s.id === 'thread-beta')!
    expect(betaSurface.surfaceClass).toBe('sealed')
    expect(betaSurface.visibility).toBe('self_only')
    expect(betaSurface.isolationLabel).toBe('THREADOS_SCOPED')
    expect(betaSurface.revealState).toBe('sealed')
  })

  test('non-sealed steps get visibility="dependency" and isolationLabel="NONE"', () => {
    const result = compilePack(makeManifest())
    const alphaSurface = result.surfaces.find(s => s.id === 'thread-alpha')!
    expect(alphaSurface.surfaceClass).toBe('shared')
    expect(alphaSurface.visibility).toBe('dependency')
    expect(alphaSurface.isolationLabel).toBe('NONE')
    expect(alphaSurface.revealState).toBeNull()
  })

  test('sets dependencies correctly on compiled steps', () => {
    const result = compilePack(makeManifest())
    const alphaStep = result.sequence.steps.find(s => s.id === 'alpha')!
    const betaStep = result.sequence.steps.find(s => s.id === 'beta')!
    expect(alphaStep.depends_on).toEqual([])
    expect(betaStep.depends_on).toEqual(['alpha'])
  })

  test('sets prompt_file paths to .threados/prompts/{id}.md when not specified', () => {
    const result = compilePack(makeManifest())
    const alphaStep = result.sequence.steps.find(s => s.id === 'alpha')!
    const betaStep = result.sequence.steps.find(s => s.id === 'beta')!
    expect(alphaStep.prompt_file).toBe('.threados/prompts/alpha.md')
    expect(betaStep.prompt_file).toBe('.threados/prompts/beta.md')
  })

  test('uses explicit prompt_file when provided in manifest step', () => {
    const manifest = makeManifest()
    manifest.steps[0] = { ...manifest.steps[0], prompt_file: 'custom/path/alpha.md' }
    const result = compilePack(manifest)
    const alphaStep = result.sequence.steps.find(s => s.id === 'alpha')!
    expect(alphaStep.prompt_file).toBe('custom/path/alpha.md')
  })

  test('step surfaces have correct parent linkage and depth', () => {
    const result = compilePack(makeManifest())
    for (const surface of result.surfaces.slice(1)) {
      expect(surface.parentSurfaceId).toBe('thread-root')
      expect(surface.depth).toBe(1)
      expect(surface.childSurfaceIds).toEqual([])
    }
  })
})

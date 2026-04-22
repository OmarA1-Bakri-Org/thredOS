import { describe, expect, test } from 'bun:test'
import { ZodError } from 'zod'
import { compilePack } from './compiler'
import type { PackManifest } from './pack-schema'
import type { Sequence } from '../sequence/schema'

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
  ...overrides,
})

describe('compilePack', () => {
  test('produces a valid sequence with correct name, pack_id, pack_version', () => {
    const result = compilePack(makeManifest())
    const sequence = result.sequence as Sequence
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
  })

  test('propagates step execution metadata into the compiled sequence', () => {
    const result = compilePack(makeManifest())
    const alphaStep = result.sequence.steps.find(s => s.id === 'alpha')!
    const betaStep = result.sequence.steps.find(s => s.id === 'beta')!

    expect(alphaStep.timeout_ms).toBe(30000)
    expect(alphaStep.gate_set_ref).toBe('default-gates')
    expect(alphaStep.side_effect_class).toBe('execute')
    expect(alphaStep.execution).toBe('sequential')
    expect(alphaStep.condition).toBe('first_run == true')
    expect(alphaStep.actions).toEqual([
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
    expect(betaStep.execution).toBe('sub_agent')
    expect(betaStep.actions).toEqual([
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

  test('materializes installed prompt_file separately from authored prompt source when manifest prompt_file is provided', () => {
    const manifest = makeManifest()
    manifest.steps[0] = { ...manifest.steps[0], prompt_file: 'custom/path/alpha.md' }
    const result = compilePack(manifest)
    const alphaStep = result.sequence.steps.find(s => s.id === 'alpha')!
    expect(alphaStep.prompt_file).toBe('.threados/prompts/alpha.md')
    expect(alphaStep.prompt_ref).toEqual({
      id: 'alpha',
      version: 1,
      path: 'custom/path/alpha.md',
    })
  })

  test('step surfaces have correct parent linkage and depth', () => {
    const result = compilePack(makeManifest())
    for (const surface of result.surfaces.slice(1)) {
      expect(surface.parentSurfaceId).toBe('thread-root')
      expect(surface.depth).toBe(1)
      expect(surface.childSurfaceIds).toEqual([])
    }
  })

  test('rejects invalid step ids with explicit diagnostics', () => {
    const base = makeManifest()
    const manifest = makeManifest({
      steps: [
        {
          ...base.steps[0],
          id: 'Alpha_Step',
        },
      ],
    }) as PackManifest

    try {
      compilePack(manifest)
      throw new Error('expected compilePack to reject invalid ids')
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError)
      const zodError = error as ZodError
      expect(zodError.issues).toContainEqual(expect.objectContaining({
        path: ['steps', 0, 'id'],
        message: 'Step ID must contain only lowercase letters, numbers, and hyphens',
      }))
    }
  })

  test('rejects missing dependency references with explicit diagnostics', () => {
    const base = makeManifest()
    const manifest = makeManifest({
      steps: [
        base.steps[0],
        {
          ...base.steps[1],
          depends_on: ['missing-step'],
        },
      ],
    }) as PackManifest

    try {
      compilePack(manifest)
      throw new Error('expected compilePack to reject missing deps')
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError)
      const zodError = error as ZodError
      expect(zodError.issues).toContainEqual(expect.objectContaining({
        path: ['steps', 1, 'depends_on', 0],
        message: 'Unknown dependency step "missing-step"',
      }))
    }
  })

  test('rejects invalid phase refs with explicit diagnostics', () => {
    const base = makeManifest()
    const manifest = makeManifest({
      steps: [
        base.steps[0],
        {
          ...base.steps[1],
          phase: 'missing-phase',
        },
      ],
    }) as PackManifest

    try {
      compilePack(manifest)
      throw new Error('expected compilePack to reject invalid phase refs')
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError)
      const zodError = error as ZodError
      expect(zodError.issues).toContainEqual(expect.objectContaining({
        path: ['steps', 1, 'phase'],
        message: 'Unknown phase "missing-phase"',
      }))
    }
  })

  test('rejects invalid gate targets with explicit diagnostics', () => {
    const base = makeManifest()
    const manifest = makeManifest({
      gates: [
        {
          ...base.gates[0],
          step_id: 'missing-step',
        },
      ],
    }) as PackManifest

    try {
      compilePack(manifest)
      throw new Error('expected compilePack to reject invalid gate targets')
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError)
      const zodError = error as ZodError
      expect(zodError.issues).toContainEqual(expect.objectContaining({
        path: ['gates', 0, 'step_id'],
        message: 'Unknown gate target step "missing-step"',
      }))
    }
  })
})

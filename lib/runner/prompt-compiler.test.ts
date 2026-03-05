import { describe, test, expect } from 'bun:test'
import { compilePrompt } from './prompt-compiler'
import type { Sequence, Step } from '../sequence/schema'

function makeStep(overrides: Partial<Step> = {}): Step {
  return {
    id: 'test-step',
    name: 'Test Step',
    type: 'base',
    model: 'claude-code',
    prompt_file: '.threados/prompts/test-step.md',
    depends_on: [],
    status: 'READY',
    ...overrides,
  }
}

function makeSequence(steps: Step[] = [], gates: any[] = []): Sequence {
  return {
    version: '1.0',
    name: 'test-seq',
    steps,
    gates,
  }
}

describe('compilePrompt', () => {
  test('includes step identity', async () => {
    const step = makeStep({ id: 'build', name: 'Build Feature' })
    const seq = makeSequence([step])
    const result = await compilePrompt({
      stepId: 'build',
      step,
      rawPrompt: 'Implement the build system.',
      sequence: seq,
      basePath: '/tmp/nonexistent',
    })

    expect(result).toContain('step `build`')
    expect(result).toContain('Build Feature')
    expect(result).toContain('Thread type: base')
    expect(result).toContain('Model: claude-code')
  })

  test('includes raw prompt content', async () => {
    const step = makeStep()
    const seq = makeSequence([step])
    const prompt = 'Create a REST API endpoint for user authentication.\n\nRequirements:\n- JWT tokens\n- Rate limiting'
    const result = await compilePrompt({
      stepId: 'test-step',
      step,
      rawPrompt: prompt,
      sequence: seq,
      basePath: '/tmp/nonexistent',
    })

    expect(result).toContain('REST API endpoint')
    expect(result).toContain('JWT tokens')
    expect(result).toContain('Rate limiting')
  })

  test('includes sequence state for done steps', async () => {
    const done = makeStep({ id: 'plan', name: 'Plan', status: 'DONE' })
    const current = makeStep({ id: 'impl', name: 'Implement', depends_on: ['plan'] })
    const pending = makeStep({ id: 'test', name: 'Test', depends_on: ['impl'] })
    const seq = makeSequence([done, current, pending])

    const result = await compilePrompt({
      stepId: 'impl',
      step: current,
      rawPrompt: 'Do the thing.',
      sequence: seq,
      basePath: '/tmp/nonexistent',
    })

    expect(result).toContain('Completed: plan')
    expect(result).toContain('Pending: test')
  })

  test('includes gate state', async () => {
    const step = makeStep()
    const seq = makeSequence([step], [
      { id: 'gate-review', name: 'Review', status: 'APPROVED', depends_on: [] },
      { id: 'gate-deploy', name: 'Deploy', status: 'PENDING', depends_on: [] },
    ])

    const result = await compilePrompt({
      stepId: 'test-step',
      step,
      rawPrompt: 'Task.',
      sequence: seq,
      basePath: '/tmp/nonexistent',
    })

    expect(result).toContain('gate-review (APPROVED)')
    expect(result).toContain('gate-deploy (PENDING)')
  })

  test('includes chained thread context', async () => {
    const s1 = makeStep({ id: 'phase-1', type: 'c', status: 'DONE' })
    const s2 = makeStep({ id: 'phase-2', type: 'c', depends_on: ['phase-1'] })
    const s3 = makeStep({ id: 'phase-3', type: 'c', depends_on: ['phase-2'] })
    const seq = makeSequence([s1, s2, s3])

    const result = await compilePrompt({
      stepId: 'phase-2',
      step: s2,
      rawPrompt: 'Phase 2 work.',
      sequence: seq,
      basePath: '/tmp/nonexistent',
    })

    expect(result).toContain('Chained workflow')
    expect(result).toContain('phase 2 of 3')
  })

  test('includes parallel thread context', async () => {
    const s1 = makeStep({ id: 'worker-a', type: 'p', group_id: 'grp-1' })
    const s2 = makeStep({ id: 'worker-b', type: 'p', group_id: 'grp-1' })
    const s3 = makeStep({ id: 'worker-c', type: 'p', group_id: 'grp-1' })
    const seq = makeSequence([s1, s2, s3])

    const result = await compilePrompt({
      stepId: 'worker-b',
      step: s2,
      rawPrompt: 'Parallel work.',
      sequence: seq,
      basePath: '/tmp/nonexistent',
    })

    expect(result).toContain('Parallel execution')
    expect(result).toContain('worker 2 of 3')
    expect(result).toContain('Work independently')
  })

  test('handles parallel step without group_id', async () => {
    const s1 = makeStep({ id: 'lone-worker', type: 'p' })
    const seq = makeSequence([s1])

    const result = await compilePrompt({
      stepId: 'lone-worker',
      step: s1,
      rawPrompt: 'Solo parallel.',
      sequence: seq,
      basePath: '/tmp/nonexistent',
    })

    expect(result).toContain('Parallel execution')
    expect(result).toContain('Work independently')
    expect(result).not.toContain('worker 0')
  })

  test('includes fusion synth context', async () => {
    const c1 = makeStep({ id: 'cand-1', type: 'f', fusion_candidates: true })
    const c2 = makeStep({ id: 'cand-2', type: 'f', fusion_candidates: true })
    const synth = makeStep({ id: 'synth', type: 'f', fusion_synth: true, depends_on: ['cand-1', 'cand-2'] })
    const seq = makeSequence([c1, c2, synth])

    const result = await compilePrompt({
      stepId: 'synth',
      step: synth,
      rawPrompt: 'Synthesize.',
      sequence: seq,
      basePath: '/tmp/nonexistent',
    })

    expect(result).toContain('Fusion synthesis')
    expect(result).toContain('2 candidates')
  })

  test('includes exit code protocol', async () => {
    const step = makeStep()
    const seq = makeSequence([step])

    const result = await compilePrompt({
      stepId: 'test-step',
      step,
      rawPrompt: 'Do work.',
      sequence: seq,
      basePath: '/tmp/nonexistent',
    })

    expect(result).toContain('Exit 0 on success')
    expect(result).toContain('Exit 42')
    expect(result).toContain('FILES_CREATED')
  })

  test('truncates within token budget', async () => {
    const step = makeStep()
    const seq = makeSequence([step])
    const hugePrompt = 'x'.repeat(50000)
    const maxTokens = 2000
    const maxChars = maxTokens * 4 // CHARS_PER_TOKEN = 4

    const result = await compilePrompt({
      stepId: 'test-step',
      step,
      rawPrompt: hugePrompt,
      sequence: seq,
      basePath: '/tmp/nonexistent',
      maxTokens,
    })

    expect(result.length).toBeLessThanOrEqual(maxChars)
    expect(result).toContain('truncated')
  })
})

import { afterEach, describe, test, expect } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { compilePrompt } from './prompt-compiler'
import type { Gate, Sequence, Step } from '../sequence/schema'

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

function makeSequence(steps: Step[] = [], gates: Gate[] = []): Sequence {
  return {
    version: '1.0',
    name: 'test-seq',
    steps,
    gates,
  }
}

describe('compilePrompt', () => {
  const temporaryRoots: string[] = []

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
  })

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

  test('describes a logical in-workspace cwd without disclosing its private root', async () => {
    const basePath = await mkdtemp(join(tmpdir(), 'threados-prompt-canonical-'))
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'threados-prompt-workspace-'))
    const executionRoot = join(workspaceRoot, 'packages', 'app')
    temporaryRoots.push(basePath, workspaceRoot)
    await mkdir(executionRoot, { recursive: true })
    await writeFile(join(executionRoot, 'workspace-file.txt'), 'workspace content')
    const step = makeStep()

    const result = await compilePrompt({
      stepId: step.id,
      step,
      rawPrompt: 'Work only in the isolated workspace.',
      sequence: makeSequence([step]),
      basePath,
      executionRoot,
      logicalWorkingDirectory: './packages/app',
      runtimeEventLogPath: join(executionRoot, '.threados-runtime', 'events.ndjson'),
      workspaceContext: {
        workspace_id: 'workspace-1',
        snapshot_id: 'snapshot-1',
        isolation_label: 'THREADOS_SCOPED',
        instruction: 'Treat this workspace as the only writable project root.',
      },
    })

    expect(result).toContain('## Working Directory\n\n`./packages/app`')
    expect(result).toContain('workspace-file.txt')
    expect(result).not.toContain(executionRoot)
    expect(result).not.toContain(basePath)
    expect(result).toContain('provided THREADOS_EVENT_LOG path')
  })

  test('loads dependency artifacts only from the explicitly selected workflow run', async () => {
    const basePath = await mkdtemp(join(tmpdir(), 'threados-prompt-artifacts-'))
    temporaryRoots.push(basePath)
    const currentArtifactDir = join(basePath, '.threados', 'runs', 'run-current', 'plan')
    const unrelatedArtifactDir = join(basePath, '.threados', 'runs', 'run-unrelated', 'plan')
    await mkdir(currentArtifactDir, { recursive: true })
    await mkdir(unrelatedArtifactDir, { recursive: true })
    await writeFile(join(currentArtifactDir, 'stdout.log'), 'CURRENT_RUN_OUTPUT')
    await writeFile(join(unrelatedArtifactDir, 'stdout.log'), 'UNRELATED_RUN_OUTPUT')
    const dependency = makeStep({ id: 'plan', status: 'DONE' })
    const step = makeStep({ id: 'implement', depends_on: ['plan'] })

    const result = await compilePrompt({
      stepId: step.id,
      step,
      rawPrompt: 'Use the dependency output.',
      sequence: makeSequence([dependency, step]),
      basePath,
      dependencyArtifactRunId: 'run-current',
    })

    expect(result).toContain('CURRENT_RUN_OUTPUT')
    expect(result).not.toContain('UNRELATED_RUN_OUTPUT')
  })

  test('does not fall back to historical artifacts for an isolated workspace without a run scope', async () => {
    const basePath = await mkdtemp(join(tmpdir(), 'threados-prompt-isolated-artifacts-'))
    const executionRoot = await mkdtemp(join(tmpdir(), 'threados-prompt-isolated-root-'))
    temporaryRoots.push(basePath, executionRoot)
    const artifactDir = join(basePath, '.threados', 'runs', 'historical-run', 'plan')
    await mkdir(artifactDir, { recursive: true })
    await writeFile(join(artifactDir, 'stdout.log'), 'HISTORICAL_OUTPUT_MUST_STAY_DARK')
    const dependency = makeStep({ id: 'plan', status: 'DONE' })
    const step = makeStep({ id: 'implement', depends_on: ['plan'] })

    const result = await compilePrompt({
      stepId: step.id,
      step,
      rawPrompt: 'Work in isolation.',
      sequence: makeSequence([dependency, step]),
      basePath,
      executionRoot,
      workspaceContext: {
        workspace_id: 'workspace-1',
        snapshot_id: 'snapshot-1',
        isolation_label: 'THREADOS_SCOPED',
        instruction: 'Treat this workspace as the only writable project root.',
      },
    })

    expect(result).not.toContain('Prior Step Outputs')
    expect(result).not.toContain('HISTORICAL_OUTPUT_MUST_STAY_DARK')
  })

  test('keeps dependency artifacts dark when the surface is sealed', async () => {
    const basePath = await mkdtemp(join(tmpdir(), 'threados-prompt-sealed-'))
    temporaryRoots.push(basePath)
    const artifactDir = join(basePath, '.threados', 'runs', 'run-current', 'plan')
    await mkdir(artifactDir, { recursive: true })
    await writeFile(join(artifactDir, 'stdout.log'), 'SEALED_OUTPUT_MUST_STAY_DARK')
    const dependency = makeStep({ id: 'plan', status: 'DONE' })
    const step = makeStep({ id: 'implement', depends_on: ['plan'] })

    const result = await compilePrompt({
      stepId: step.id,
      step,
      rawPrompt: 'Do not reveal sealed dependency output.',
      sequence: makeSequence([dependency, step]),
      basePath,
      dependencyArtifactRunId: 'run-current',
      includeDependencyArtifacts: false,
    })

    expect(result).not.toContain('Prior Step Outputs')
    expect(result).not.toContain('SEALED_OUTPUT_MUST_STAY_DARK')
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
      { id: 'gate-review', name: 'Review', status: 'APPROVED', depends_on: [], cascade: false, childGateIds: [] },
      { id: 'gate-deploy', name: 'Deploy', status: 'PENDING', depends_on: [], cascade: false, childGateIds: [] },
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

  test('includes runtime delegation event contract when an event log path is provided', async () => {
    const step = makeStep({ id: 'orchestrator-step', type: 'b' })
    const seq = makeSequence([step])

    const result = await compilePrompt({
      stepId: 'orchestrator-step',
      step,
      rawPrompt: 'Delegate work when needed.',
      sequence: seq,
      basePath: '/tmp/nonexistent',
      runtimeEventLogPath: '/tmp/threados/runs/run-1/orchestrator-step/events.jsonl',
    })

    expect(result).toContain('THREADOS_EVENT_LOG')
    expect(result).toContain('spawn-child')
    expect(result).toContain('merge-into')
    expect(result).toContain('/tmp/threados/runs/run-1/orchestrator-step/events.jsonl')
  })

  test('prefers THREADOS_EVENT_EMITTER guidance when an emitter command is provided', async () => {
    const step = makeStep({ id: 'orchestrator-step', type: 'b' })
    const seq = makeSequence([step])

    const result = await compilePrompt({
      stepId: 'orchestrator-step',
      step,
      rawPrompt: 'Delegate work when needed.',
      sequence: seq,
      basePath: '/tmp/nonexistent',
      runtimeEventLogPath: '/tmp/threados/runs/run-1/orchestrator-step/events.jsonl',
      runtimeEventEmitterCommand: 'thread event',
    })

    expect(result).toContain('THREADOS_EVENT_EMITTER')
    expect(result).toContain('thread event spawn-child')
    expect(result).toContain('thread event merge-into')
    expect(result).toContain('Prefer the emitter command')
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

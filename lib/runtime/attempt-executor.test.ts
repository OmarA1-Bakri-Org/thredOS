import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RunRepository } from './run-repository'
import { transitionRun } from './lifecycle'
import { RuntimeServiceError } from './errors'
import { ThreadOSRuntimeService } from './service'
import { SequentialScheduler } from './scheduler'
import { AttemptRepository } from './attempt-repository'
import { ProcessRepository } from './process-repository'
import { CommandRepository } from './command-repository'
import type { RuntimeServiceDependencies } from './service-types'
import { PolicyConfigSchema } from '../policy/schema'
import type { Sequence } from '../sequence/schema'
import { evaluateStepGates } from '../gates/engine'
import { ProcessTimeoutError } from '../errors'
import type { Approval } from '../contracts/schemas'
import { executableSubjectDigest } from '../policy/executable'
import type { RawProcessResult, RunningProcessHandle } from '../runner/process-handle'
import type { RunResult } from '../runner/wrapper'
import { createTestCompatibilityStartProcess } from './test-compatibility'
import { runWorkspaceBootstrap, WorkspaceBootstrapError } from '../workspaces/bootstrap'
import { buildAgentComposition } from '../agents/composition'
import { writeAgentState } from '../agents/repository'

const fixturePromptRef = { id: 'registered-command', version: 2, path: '.threados/prompts/registered-command.md' }
const fixtureSkillRefs = [{ id: 'fixture-files', version: 1, path: '.threados/skills/fixture-files/SKILL.md', capabilities: ['read'] }]
const fixturePrompt = 'registered fixture command'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

function seq(): Sequence {
  return { version: '1', id: 's', name: 's', gates: [], groups: [], fusion_rules: [], steps: [{
    id: 'x', name: 'x', type: 'base', model: 'shell', prompt_file: '.threados/prompts/x.md',
    assigned_agent_id: 'registered-x', agent_ref: 'registered-x', role: 'fixture-executor',
    prompt_ref: fixturePromptRef, skill_refs: fixtureSkillRefs,
    status: 'READY', depends_on: [], side_effect_class: 'execute',
  }] } as Sequence
}

async function make(overrides: Partial<RuntimeServiceDependencies>, workspaceRoot?: string) {
  const basePath = await mkdtemp(join(tmpdir(), 'threados-attempt-')); roots.push(basePath)
  await mkdir(join(basePath, '.threados/prompts'), { recursive: true })
  await mkdir(join(basePath, '.threados/skills/fixture-files'), { recursive: true })
  await writeFile(join(basePath, fixturePromptRef.path), fixturePrompt)
  await writeFile(join(basePath, fixtureSkillRefs[0]!.path), 'Read fixture files within the assigned workspace.')
  await writeAgentState(basePath, { version: 1, agents: [{
    id: 'registered-x', name: 'Registered Executor Fixture',
    builderId: 'fixture-builder', builderName: 'Fixture Builder',
    registeredAt: '2026-01-01T00:00:00.000Z', version: 1, threadSurfaceIds: [],
    composition: buildAgentComposition({
      model: 'shell', role: 'fixture-executor', promptRef: fixturePromptRef,
      skillRefs: fixtureSkillRefs, tools: ['files'],
    }),
  }] })
  let id = 0
  const defaultRunStep: NonNullable<RuntimeServiceDependencies['runStep']> = async c => ({
    stepId: c.stepId, runId: c.runId, exitCode: 0, status: 'SUCCESS', duration: 1,
    stdout: '', stderr: '', startTime: new Date(), endTime: new Date(),
  })
  const selectedRunStep = overrides.runStep ?? defaultRunStep
  const deps: RuntimeServiceDependencies = {
    now: () => '2026-01-01T00:00:00.000Z', newId: p => `${p}-${++id}`,
    loadSequence: async () => seq(), loadPolicy: async () => PolicyConfigSchema.parse({ mode: 'POWER', side_effect_mode: 'free' }),
    validateSequence: () => undefined, validatePrompt: async () => true, compilePrompt: async () => 'prompt',
    prepareRunWorkspace: async () => ({ snapshotId: 'snapshot-test', snapshotManifestRef: '.threados/snapshots/snapshot-test/manifest.json', canonicalPreHash: `sha256:${'b'.repeat(64)}` }),
    verifyCanonicalWorkspace: async () => ({ preHash: `sha256:${'b'.repeat(64)}`, postHash: `sha256:${'b'.repeat(64)}`, classification: 'unchanged', evidenceRef: 'canonical-precondition.json' }),
    prepareAttemptWorkspace: async ({ run, attempt, step, snapshotId }) => ({
      manifestHash: `sha256:${'a'.repeat(64)}`,
      workspaceManifestRef: `.threados/workspaces/records/workspace-${attempt.id}.json`,
      context: {
        cwd: workspaceRoot ?? basePath,
        workspaceId: `workspace-${attempt.id}`,
        snapshotId,
        attemptId: attempt.id,
        workflowRunId: run.id,
        isolationLabel: 'THREADOS_SCOPED',
        environment: {
          THREADOS_WORKSPACE_ID: `workspace-${attempt.id}`,
          THREADOS_SNAPSHOT_ID: snapshotId,
          THREADOS_ATTEMPT_ID: attempt.id,
          THREADOS_RUN_ID: run.id,
          THREADOS_STEP_ID: step.id,
        },
        promptContext: {
          workspace_id: `workspace-${attempt.id}`,
          snapshot_id: snapshotId,
          isolation_label: 'THREADOS_SCOPED',
          instruction: 'Operate only in the provided working directory.',
        },
      },
    }),
    bootstrapWorkspace: async () => undefined,
    finalizeAttemptWorkspace: async () => undefined,
    prepareArtifacts: async () => undefined,
    resolveGateSurface: async () => ({ surfaceClass: 'shared', revealState: null }),
    allowModelExecution: () => ({ allowed: true }),
    dispatch: async (_m, o) => ({ stepId: o.stepId, runId: o.runId, command: 'sh', args: [], cwd: basePath }),
    runStep: selectedRunStep,
    saveArtifacts: async () => 'artifact', readRuntimeEvents: async () => [], readApprovals: async () => [],
    evaluatePreGates: () => [], evaluateCompletionGates: () => [], persistGateDecisions: async () => undefined,
    enforceBatchPolicy: () => ({ allowed: true, confirmation_required: false }), enforceExecutablePolicy: () => ({ allowed: true, confirmation_required: false }),
    recordApproval: async () => undefined, appendTrace: async () => undefined,
    projections: { beginRun: async () => undefined, beginAttempt: async () => undefined, finalizeAttempt: async () => undefined, finalizeRun: async () => undefined },
    ...overrides,
    startProcess: overrides.startProcess
      ?? createTestCompatibilityStartProcess(selectedRunStep),
  }
  const repositories = {
    runs: new RunRepository(basePath),
    attempts: new AttemptRepository(basePath),
    processes: new ProcessRepository(basePath),
    commands: new CommandRepository(basePath),
  }
  return {
    basePath,
    repositories,
    service: new ThreadOSRuntimeService({
      basePath,
      scheduler: new SequentialScheduler(),
      repositories,
      dependencies: deps,
    }),
  }
}

const context = { actor: 't', interface: 'system' as const, idempotencyKey: 'k', policyConfirmed: true }
const cmd = { sequence_id: 's', target: { kind: 'step' as const, step_id: 'x' }, strategy: 'sequential' as const, max_concurrency: 1 }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

function rawResult(
  overrides: Partial<RawProcessResult> = {},
): RawProcessResult {
  return {
    stepId: 'x',
    runId: 'run-1',
    exitCode: 0,
    signal: null,
    status: 'SUCCESS',
    duration: 4,
    stdout: 'ok',
    stderr: '',
    startTime: new Date('2026-01-01T00:00:00.000Z'),
    endTime: new Date('2026-01-01T00:00:00.004Z'),
    ...overrides,
  }
}

describe('AttemptExecutor and lifecycle', () => {
  test('launches the registered canonical prompt and freezes identity without a step-named prompt', async () => {
    let legacyPromptChecks = 0
    let compiled = 0
    const { basePath, service, repositories } = await make({
      validatePrompt: async () => { legacyPromptChecks += 1; return false },
      compilePrompt: async input => {
        compiled += 1
        expect(input.rawPrompt).toBe(fixturePrompt)
        expect(input.step.prompt_file).toBe(fixturePromptRef.path)
        expect(input.agentRegistration).toMatchObject({
          registration_id: 'registered-x', registration_version: 1,
          prompt_ref: fixturePromptRef, skill_refs: fixtureSkillRefs,
        })
        return input.rawPrompt
      },
    })

    expect(existsSync(join(basePath, '.threados/prompts/x.md'))).toBe(false)
    const outcome = await service.runAndWait(cmd, context)
    expect(outcome.run.status).toBe('successful')
    expect(compiled).toBe(1)
    expect(legacyPromptChecks).toBe(0)
    const attempt = outcome.attempts[0]!
    expect(attempt).toMatchObject({ status: 'completed', agent_ref: 'registered-x' })
    expect(attempt.agent_registration).toMatchObject({
      registration_id: 'registered-x', registration_version: 1,
      builder_id: 'fixture-builder', prompt_ref: fixturePromptRef,
    })
    expect(attempt.agent_registration?.prompt_content_hash).toHaveLength(64)
    expect(attempt.agent_registration?.skill_content_hashes).toHaveLength(1)
    expect(outcome.run.agent_registrations?.x).toEqual(attempt.agent_registration)
    expect((await repositories.attempts.get(attempt.id))?.agent_registration).toEqual(attempt.agent_registration)
    expect((await repositories.runs.get(outcome.run.id))?.agent_registrations?.x).toEqual(attempt.agent_registration)
  }, 30_000)

  test('an unknown assignment is not registered by fixture setup and cannot dispatch', async () => {
    const sequence = seq()
    sequence.steps[0]!.assigned_agent_id = 'unknown-registration'
    sequence.steps[0]!.agent_ref = 'unknown-registration'
    let dispatches = 0
    const { service, repositories } = await make({
      loadSequence: async () => sequence,
      dispatch: async () => { dispatches += 1; throw new Error('must not dispatch') },
    })

    const outcome = await service.runAndWait(cmd, context)
    expect(outcome.run).toMatchObject({ status: 'failed', error_code: 'AGENT_NOT_REGISTERED' })
    expect(outcome.attempts).toEqual([])
    expect(await repositories.processes.list()).toEqual([])
    expect(dispatches).toBe(0)
  }, 30_000)

  test('registered prompt mutation after freezing fails before compilation or dispatch', async () => {
    let compiled = 0
    let dispatches = 0
    const built = await make({
      bootstrapWorkspace: async () => {
        await writeFile(join(built.basePath, fixturePromptRef.path), 'changed registered command')
      },
      compilePrompt: async () => { compiled += 1; return 'must not compile' },
      dispatch: async () => { dispatches += 1; throw new Error('must not dispatch') },
    })

    const outcome = await built.service.runAndWait(cmd, context)
    expect(outcome.run.status).toBe('failed')
    expect(outcome.attempts[0]).toMatchObject({ status: 'failed', error_code: 'AGENT_IDENTITY_CHANGED' })
    expect(outcome.run.agent_registrations?.x).toEqual(outcome.attempts[0]?.agent_registration)
    expect(await built.repositories.processes.list()).toEqual([])
    expect(compiled).toBe(0)
    expect(dispatches).toBe(0)
  }, 30_000)

  test('write attempts bind one verified isolated workspace before compile, gates, dispatch, and spawn', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'threados-attempt-workspace-'))
    roots.push(workspaceRoot)
    await mkdir(join(workspaceRoot, 'src'), { recursive: true })
    const order: string[] = []
    const finalized: string[] = []
    let dispatchedEnv: Record<string, string> | undefined
    let workspaceEventLogPath: string | undefined

    const { basePath, service } = await make({
      prepareRunWorkspace: async () => {
        order.push('snapshot')
        return {
          snapshotId: 'snapshot-shared',
          snapshotManifestRef: '.threados/snapshots/snapshot-shared/manifest.json',
          canonicalPreHash: `sha256:${'b'.repeat(64)}`,
        }
      },
      prepareAttemptWorkspace: async ({ attempt }: { attempt: { id: string } }) => {
        order.push(`workspace:${attempt.id}`)
        return {
          manifestHash: `sha256:${'a'.repeat(64)}`,
          workspaceManifestRef: '.threados/workspaces/records/workspace-1.json',
          context: {
            cwd: workspaceRoot,
            workspaceId: 'workspace-1',
            snapshotId: 'snapshot-shared',
            attemptId: attempt.id,
            workflowRunId: 'run-1',
            isolationLabel: 'THREADOS_SCOPED',
            environment: {
              THREADOS_WORKSPACE_ID: 'workspace-1',
              THREADOS_SNAPSHOT_ID: 'snapshot-shared',
              THREADOS_ATTEMPT_ID: attempt.id,
              THREADOS_RUN_ID: 'run-1',
              THREADOS_STEP_ID: 'x',
            },
            promptContext: {
              workspace_id: 'workspace-1',
              snapshot_id: 'snapshot-shared',
              isolation_label: 'THREADOS_SCOPED',
              instruction: 'Operate only in the provided working directory.',
            },
          },
        }
      },
      bootstrapWorkspace: async () => { order.push('bootstrap') },
      compilePrompt: async input => {
        order.push(`compile:${input.executionRoot}`)
        expect(input.executionRoot).toBe(workspaceRoot)
        expect(JSON.stringify(input.workspaceContext)).not.toContain(input.basePath)
        return 'prompt'
      },
      evaluatePreGates: input => {
        order.push('gates')
        expect(input.workspaceReady).toBe(true)
        return []
      },
      dispatch: async (_model, options) => {
        order.push('dispatch')
        expect(options.cwd).toBe(workspaceRoot)
        expect(options.cwd).not.toBe(basePath)
        dispatchedEnv = options.env
        workspaceEventLogPath = options.runtimeEventLogPath
        expect(options.runtimeEventLogPath?.startsWith(workspaceRoot)).toBe(true)
        expect(options.runtimeEventLogPath?.startsWith(basePath)).toBe(false)
        expect(options.deniedEnvKeys).toContain('THREADOS_BASE_PATH')
        return { stepId: options.stepId, runId: options.runId, command: 'sh', args: [], cwd: options.cwd, env: options.env }
      },
      readRuntimeEvents: async (_basePath, _runId, _stepId, runtimeEventLogPath, executionRoot) => {
        expect(runtimeEventLogPath).toBe(workspaceEventLogPath)
        expect(executionRoot).toBe(workspaceRoot)
        return []
      },
      finalizeAttemptWorkspace: async ({ attempt }: { attempt: { status: string } }) => {
        order.push('workspace-finalized')
        finalized.push(attempt.status)
      },
      verifyCanonicalWorkspace: async () => {
        order.push('canonical-evidence')
        return {
          preHash: `sha256:${'b'.repeat(64)}`,
          postHash: `sha256:${'b'.repeat(64)}`,
          classification: 'unchanged',
          evidenceRef: 'canonical-precondition.json',
        }
      },
    })

    const outcome = await service.runAndWait(cmd, context)
    expect(outcome.run.baseline_snapshot_id).toBe('snapshot-shared')
    expect(outcome.attempts[0]).toMatchObject({
      status: 'completed',
      baseline_snapshot_id: 'snapshot-shared',
      workspace_id: 'workspace-1',
    })
    expect(order.slice(0, 6)).toEqual([
      'snapshot',
      `workspace:${outcome.attempts[0]!.id}`,
      'bootstrap',
      `compile:${workspaceRoot}`,
      'gates',
      'dispatch',
    ])
    expect(dispatchedEnv).toMatchObject({
      THREADOS_WORKSPACE_ID: 'workspace-1',
      THREADOS_SNAPSHOT_ID: 'snapshot-shared',
      THREADOS_ATTEMPT_ID: outcome.attempts[0]!.id,
    })
    expect(dispatchedEnv).not.toHaveProperty('THREADOS_BASE_PATH')
    expect(finalized).toEqual(['completed'])
    expect(order.slice(-2)).toEqual(['canonical-evidence', 'workspace-finalized'])
  }, 30_000)

  test('preserves typed bootstrap failures and still finalizes the isolated workspace', async () => {
    const finalized: string[] = []
    const { service } = await make({
      bootstrapWorkspace: async () => {
        throw new WorkspaceBootstrapError('bootstrap failed', 0)
      },
      finalizeAttemptWorkspace: async ({ attempt }) => { finalized.push(attempt.status) },
    })

    const outcome = await service.runAndWait(cmd, context)

    expect(outcome.run.status).toBe('failed')
    expect(outcome.attempts[0]).toMatchObject({
      status: 'failed',
      error_code: 'WORKSPACE_BOOTSTRAP_FAILED',
    })
    expect(finalized).toEqual(['failed'])
  }, 30_000)

  for (const phase of ['before first bootstrap', 'between bootstrap commands'] as const) {
    test.each(['removed registration', 'changed registration', 'changed prompt', 'changed skill'] as const)(
      `revalidates frozen identity ${phase}: %s`, async mutation => {
        const workspaceRoot = await mkdtemp(join(tmpdir(), 'threados-bootstrap-identity-'))
        roots.push(workspaceRoot)
        const paused = deferred<void>()
        const resume = deferred<void>()
        let starts = 0
        let dispatches = 0
        let finalized = 0
        const artifacts: string[] = []
        const built = await make({
          bootstrapWorkspace: async ({ basePath, workspace, execute }) => {
            await runWorkspaceBootstrap({
              canonicalRoot: basePath,
              context: workspace.context,
              commands: ['bootstrap-one prepare', 'bootstrap-two prepare'],
              evaluatePolicy: () => ({ allowed: true, confirmation_required: false }),
              execute: async (payload, options) => {
                if ((phase === 'before first bootstrap' && starts === 0)
                  || (phase === 'between bootstrap commands' && starts === 1)) {
                  paused.resolve()
                  await resume.promise
                }
                return await execute(payload, options)
              },
              writeArtifact: async artifact => { artifacts.push(artifact.status) },
            })
          },
          startProcess: async config => {
            starts += 1
            return {
              processId: config.processId!, pid: 4500 + starts,
              result: Promise.resolve(rawResult({ stepId: config.stepId, runId: config.runId })),
              cancel: async signal => ({ success: true, signal: signal ?? 'SIGTERM', escalated: false }),
            }
          },
          dispatch: async () => { dispatches += 1; throw new Error('agent must not dispatch') },
          finalizeAttemptWorkspace: async () => { finalized += 1 },
        }, workspaceRoot)
        const completion = built.service.runAndWait(cmd, context)
        await paused.promise
        const frozen = (await built.repositories.attempts.listForRun('run-1'))[0]!.agent_registration!
        try {
          if (mutation === 'removed registration') {
            await writeAgentState(built.basePath, { version: 1, agents: [] })
          } else if (mutation === 'changed registration') {
            await writeAgentState(built.basePath, { version: 1, agents: [{
              id: 'registered-x', name: 'Changed Executor', builderId: 'fixture-builder', builderName: 'Fixture Builder',
              registeredAt: '2026-01-01T00:00:00.000Z', version: 2, threadSurfaceIds: [],
              composition: buildAgentComposition({ model: 'shell', role: 'fixture-executor',
                promptRef: fixturePromptRef, skillRefs: fixtureSkillRefs, tools: ['files'] }),
            }] })
          } else {
            const path = mutation === 'changed prompt' ? fixturePromptRef.path : fixtureSkillRefs[0]!.path
            await writeFile(join(built.basePath, path), 'changed after frozen registration')
          }
        } finally {
          resume.resolve()
        }
        const outcome = await completion
        const expectedStarts = phase === 'before first bootstrap' ? 0 : 1
        expect(starts).toBe(expectedStarts)
        expect(dispatches).toBe(0)
        expect(finalized).toBe(1)
        expect(outcome.attempts[0]).toMatchObject({
          status: 'failed',
          agent_ref: frozen.registration_id,
          agent_registration: frozen,
          error_code: mutation === 'removed registration' ? 'AGENT_NOT_REGISTERED' : 'AGENT_IDENTITY_CHANGED',
        })
        expect(outcome.run.agent_registrations?.x).toEqual(frozen)
        expect(await built.repositories.processes.list()).toHaveLength(expectedStarts)
        expect(artifacts).toEqual(phase === 'before first bootstrap' ? ['error'] : ['success', 'error'])
      }, 30_000,
    )
  }

  test('rejects a bootstrap-created cwd symlink or junction that escapes the workspace', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'threados-cwd-workspace-'))
    roots.push(workspaceRoot)
    let dispatches = 0
    let finalized = 0
    const sequence = seq()
    sequence.steps[0]!.cwd = 'nested'
    const { basePath, service } = await make({
      loadSequence: async () => sequence,
      prepareAttemptWorkspace: async ({ run, attempt, snapshotId }) => ({
        manifestHash: `sha256:${'a'.repeat(64)}`,
        workspaceManifestRef: `.threados/workspaces/records/workspace-${attempt.id}.json`,
        context: {
          cwd: workspaceRoot,
          workspaceId: `workspace-${attempt.id}`,
          snapshotId,
          attemptId: attempt.id,
          workflowRunId: run.id,
          isolationLabel: 'THREADOS_SCOPED',
          environment: {},
          promptContext: {
            workspace_id: `workspace-${attempt.id}`,
            snapshot_id: snapshotId,
            isolation_label: 'THREADOS_SCOPED',
            instruction: 'Operate only in the provided working directory.',
          },
        },
      }),
      bootstrapWorkspace: async () => {
        await symlink(basePath, join(workspaceRoot, 'nested'), process.platform === 'win32' ? 'junction' : 'dir')
      },
      dispatch: async () => {
        dispatches += 1
        throw new Error('must not dispatch')
      },
      finalizeAttemptWorkspace: async () => { finalized += 1 },
    })

    const outcome = await service.runAndWait(cmd, context)

    expect(outcome.run.status).toBe('failed')
    expect(outcome.attempts[0]?.status).toBe('failed')
    expect(dispatches).toBe(0)
    expect(finalized).toBe(1)
  }, 30_000)

  test('preserves typed snapshot failures before attempt provisioning', async () => {
    const { service } = await make({
      prepareRunWorkspace: async () => {
        throw Object.assign(new Error('source remained unstable'), { code: 'SNAPSHOT_SOURCE_BUSY' })
      },
    })

    const outcome = await service.runAndWait(cmd, context)

    expect(outcome.run).toMatchObject({
      status: 'failed',
      error_code: 'SNAPSHOT_SOURCE_BUSY',
    })
    expect(outcome.attempts).toEqual([])
  }, 30_000)

  test('fails the run on attributed canonical mutation while preserving attempt and workspace truth', async () => {
    const finalized: string[] = []
    const { service } = await make({
      verifyCanonicalWorkspace: async () => ({
        preHash: `sha256:${'b'.repeat(64)}`,
        postHash: `sha256:${'c'.repeat(64)}`,
        classification: 'threados_mutation',
        evidenceRef: 'canonical-precondition.json',
      }),
      finalizeAttemptWorkspace: async ({ attempt }) => { finalized.push(attempt.status) },
    })

    const outcome = await service.runAndWait(cmd, context)

    expect(outcome.run).toMatchObject({
      status: 'failed',
      error_code: 'CANONICAL_WORKSPACE_MUTATED',
    })
    expect(outcome.attempts).toHaveLength(1)
    expect(outcome.attempts[0]?.status).toBe('completed')
    expect(finalized).toEqual(['completed'])
  }, 30_000)

  test('finalizes the workspace even when canonical verification itself fails', async () => {
    const finalized: string[] = []
    const { service } = await make({
      verifyCanonicalWorkspace: async () => { throw new Error('canonical evidence unavailable') },
      finalizeAttemptWorkspace: async ({ attempt }) => { finalized.push(attempt.status) },
    })

    const outcome = await service.runAndWait(cmd, context)

    expect(outcome.run.status).toBe('failed')
    expect(outcome.attempts).toHaveLength(1)
    expect(finalized).toEqual(['completed'])
  }, 30_000)

  test('finalizes the workspace when a terminal repository refresh fails', async () => {
    let terminalProjectionPersisted = false
    let finalized = 0
    const built = await make({
      projections: {
        beginRun: async () => undefined,
        beginAttempt: async () => undefined,
        finalizeAttempt: async () => { terminalProjectionPersisted = true },
        finalizeRun: async () => undefined,
      },
      finalizeAttemptWorkspace: async () => { finalized += 1 },
    })
    const originalGet = built.repositories.runs.get.bind(built.repositories.runs)
    let injected = false
    built.repositories.runs.get = async runId => {
      if (terminalProjectionPersisted && !injected) {
        injected = true
        throw new Error('terminal run refresh failed')
      }
      return await originalGet(runId)
    }

    const outcome = await built.service.runAndWait(cmd, context)

    expect(outcome.run.status).toBe('failed')
    expect(outcome.attempts).toHaveLength(1)
    expect(finalized).toBe(1)
  }, 30_000)

  test('controller owns launch persistence and maps verified success after completion gates', async () => {
    const terminal = deferred<RawProcessResult>()
    const starts: string[] = []
    const { basePath, service } = await make({
      startProcess: async config => {
        starts.push(config.processId ?? '')
        const process = (await new ProcessRepository(basePath).list())[0]
        const attempt = await new AttemptRepository(basePath).get(process!.attempt_id)
        const run = await new RunRepository(basePath).get(process!.workflow_run_id)
        expect(process).toMatchObject({
          id: config.processId,
          status: 'starting',
          pid: null,
          provider_handle: null,
        })
        expect(attempt).toMatchObject({ status: 'running', process_id: config.processId })
        expect(run?.status).toBe('running')
        return {
          processId: config.processId!,
          pid: 321,
          result: terminal.promise,
          cancel: async signal => ({
            success: true,
            signal: signal ?? 'SIGTERM',
            escalated: false,
          }),
        } satisfies RunningProcessHandle
      },
      runStep: async () => { throw new Error('compatibility runner must not be used') },
    } as Partial<RuntimeServiceDependencies> & {
      startProcess: (config: Parameters<NonNullable<RuntimeServiceDependencies['startProcess']>>[0]) => Promise<RunningProcessHandle>
    })

    const completion = service.runAndWait(cmd, context)
    while (starts.length === 0) await new Promise(resolve => setTimeout(resolve, 1))
    terminal.resolve(rawResult())
    const out = await completion

    expect(out.run.status).toBe('successful')
    expect(out.attempts[0]).toMatchObject({ status: 'completed', exit_code: 0 })
    expect(starts).toEqual([out.attempts[0]!.process_id!])
    expect((await new ProcessRepository(basePath).list())[0]).toMatchObject({
      status: 'exited',
      pid: 321,
      provider_handle: 'pid:321',
      exit_code: 0,
    })
  }, 30_000)

  test('bootstrap and agent launches use separate durable process records', async () => {
    let basePath = ''
    const starts: string[] = []
    const built = await make({
      bootstrapWorkspace: async ({ execute, workspace }) => {
        for (const command of ['bootstrap-one', 'bootstrap-two']) {
          const result = await execute({
            command,
            args: ['prepare'],
            cwd: workspace.context.cwd,
          }, {
            cwd: workspace.context.cwd,
            shell: false,
            timeoutMs: 1_000,
            maxOutputBytes: 4_096,
          })
          expect(result).toMatchObject({ exitCode: 0, stdout: 'ok' })
        }
      },
      startProcess: async config => {
        const processId = config.processId!
        starts.push(processId)
        expect(await new ProcessRepository(basePath).get(processId)).toMatchObject({
          id: processId,
          status: 'starting',
          workspace_id: expect.stringMatching(/^workspace-/),
          cwd: config.cwd,
        })
        const result = rawResult({ stepId: config.stepId, runId: config.runId })
        return {
          processId,
          pid: 4000 + starts.length,
          result: Promise.resolve(result),
          cancel: async signal => ({
            success: true,
            signal: signal ?? 'SIGTERM',
            escalated: false,
          }),
        } satisfies RunningProcessHandle
      },
    } as Partial<RuntimeServiceDependencies> & {
      startProcess: (config: Parameters<NonNullable<RuntimeServiceDependencies['startProcess']>>[0]) => Promise<RunningProcessHandle>
    })
    basePath = built.basePath

    const outcome = await built.service.runAndWait(cmd, context)
    const attempt = outcome.attempts[0]!
    const processes = await built.repositories.processes.list()
    const bootstrap = processes.filter(process => process.process_purpose === 'bootstrap')
    const agent = processes.find(process => process.id === attempt.process_id)

    expect(outcome.run.status).toBe('successful')
    expect(starts).toHaveLength(3)
    expect(new Set(starts).size).toBe(3)
    expect(bootstrap).toHaveLength(2)
    expect(bootstrap.map(process => ({
      status: process.status,
      workspace_id: process.workspace_id,
      command: process.command,
      ordinal: process.process_ordinal,
    }))).toEqual([
      { status: 'exited', workspace_id: attempt.workspace_id, command: 'bootstrap-one', ordinal: 0 },
      { status: 'exited', workspace_id: attempt.workspace_id, command: 'bootstrap-two', ordinal: 1 },
    ])
    expect(agent).toMatchObject({
      status: 'exited',
      workspace_id: attempt.workspace_id,
      process_purpose: 'agent',
      process_ordinal: 0,
    })
    expect(bootstrap.map(process => process.id)).not.toContain(agent!.id)
  }, 30_000)

  test('blocked pre-run gate durably fails and never dispatches or spawns', async () => {
    let dispatches = 0; let spawns = 0
    const { service } = await make({
      evaluatePreGates: () => [{ id: 'g', subject_type: 'step', subject_ref: 'x', gate_type: 'policy_pass', status: 'BLOCK', reason_codes: ['blocked'], evidence_refs: [], decided_by: 'threados', decided_at: '2026-01-01T00:00:00.000Z' }],
      dispatch: async () => { dispatches++; throw new Error('must not dispatch') },
      runStep: async () => { spawns++; throw new Error('must not spawn') },
    })
    const out = await service.runAndWait(cmd, context)
    expect(out.attempts[0]?.status).toBe('failed')
    expect(dispatches).toBe(0); expect(spawns).toBe(0)
    expect(out.attempts[0]?.gate_decision_refs).toEqual(['g'])
    expect(out.attempts[0]?.error_code).toBe('PRE_RUN_GATE_BLOCKED')
  }, 30_000)

  test('completion gate failure yields needs_review', async () => {
    const { service } = await make({ evaluateCompletionGates: () => [{ id: 'g', subject_type: 'step', subject_ref: 'x', gate_type: 'completion_contract_pass', status: 'BLOCK', reason_codes: ['contract'], evidence_refs: [], decided_by: 'threados', decided_at: '2026-01-01T00:00:00.000Z' }] })
    const out = await service.runAndWait(cmd, context)
    expect(out.attempts[0]?.status).toBe('needs_review')
    expect(out.run.status).toBe('awaiting_review')
  }, 30_000)

  test('failure after run creation and before spawn remains as recoverable canonical state', async () => {
    const { basePath, service } = await make({ compilePrompt: async () => { throw new Error('compile failed') } })
    const out = await service.runAndWait(cmd, context)
    expect(out.run.status).toBe('failed')
    expect((await new AttemptRepository(basePath).listForRun(out.run.id))[0]?.error_message).toContain('compile failed')
    expect(await new ProcessRepository(basePath).list()).toEqual([])
    expect((await new CommandRepository(basePath).list())[0]?.status).toBe('failed')
  }, 30_000)

  test('invalid transitions throw before repository update', async () => {
    let updates = 0
    const repo = { update: async () => { updates++; throw new Error('unexpected') } } as unknown as RunRepository
    const current = { status: 'pending', revision: 0, id: 'r' } as never
    await expect(transitionRun(repo, current, 'successful')).rejects.toBeInstanceOf(RuntimeServiceError)
    expect(updates).toBe(0)
  })

  test('exact executable policy runs after dispatch and before any process or spawn', async () => {
    const order: string[] = []
    let spawns = 0
    const { basePath, service } = await make({
      dispatch: async (_model, options) => {
        order.push('dispatch')
        return { stepId: options.stepId, runId: options.runId, command: 'sh', args: ['secret'], cwd: basePath }
      },
      enforceExecutablePolicy: input => {
        order.push(`policy:${input.payload.command}:${input.payload.args.length}`)
        return { allowed: false, confirmation_required: false, reason: 'denied exact payload' }
      },
      runStep: async () => { spawns++; throw new Error('must not spawn') },
    })
    const out = await service.runAndWait(cmd, context)
    expect(order).toEqual(['dispatch', 'policy:sh:1'])
    expect(out.attempts[0]?.error_code).toBe('POLICY_DENIED')
    expect(await new ProcessRepository(basePath).list()).toEqual([])
    expect(spawns).toBe(0)
  }, 30_000)

  test('projection failures never rewrite or replay canonical terminal truth', async () => {
    let spawns = 0
    const throwing = async () => { throw new Error('projection unavailable') }
    const { basePath, service } = await make({
      runStep: async c => {
        spawns++
        return { stepId: c.stepId, runId: c.runId, exitCode: 0, status: 'SUCCESS', duration: 1, stdout: '', stderr: '', startTime: new Date(), endTime: new Date() }
      },
      projections: { beginRun: throwing, beginAttempt: throwing, finalizeAttempt: throwing, finalizeRun: throwing },
    })
    const first = await service.runAndWait(cmd, context)
    const replay = await service.runAndWait(cmd, context)
    expect(first.run.status).toBe('successful')
    expect(first.attempts[0]?.status).toBe('completed')
    expect((await new ProcessRepository(basePath).list())[0]?.status).toBe('exited')
    expect(replay.run.id).toBe(first.run.id)
    expect(spawns).toBe(1)
  }, 30_000)

  test('missing exit evidence marks the process lost and never succeeds', async () => {
    const { basePath, service } = await make({
      runStep: async c => ({
        stepId: c.stepId, runId: c.runId, exitCode: null, status: 'ERROR', duration: 1,
        stdout: '', stderr: 'spawn failed', startTime: new Date(), endTime: new Date(),
      }),
    })
    const out = await service.runAndWait(cmd, context)
    expect(out.run.status).toBe('failed')
    expect(out.attempts[0]?.error_code).toBe('PROCESS_LOST')
    expect((await new ProcessRepository(basePath).list())[0]?.status).toBe('lost')
  }, 30_000)

  test('sealed unrevealed surface authority blocks before dispatch while revealed surfaces run', async () => {
    let dispatches = 0
    const gateEvaluator: RuntimeServiceDependencies['evaluatePreGates'] = input => evaluateStepGates(
      input.step, input.sequence.steps, input.sequence.gates, {
        policyMode: input.policy.mode, sideEffectMode: input.policy.side_effect_mode,
        crossSurfaceReads: input.policy.cross_surface_reads, surfaceClass: input.surfaceClass,
        revealState: input.revealState, isDependency: true, inputManifestPresent: true,
        approvalPresent: input.approvalPresent,
      },
    )
    const blocked = await make({
      resolveGateSurface: async () => ({ surfaceClass: 'sealed', revealState: 'sealed' }),
      evaluatePreGates: gateEvaluator,
      dispatch: async () => { dispatches++; throw new Error('must not dispatch') },
    })
    const denied = await blocked.service.runAndWait(cmd, context)
    expect(denied.attempts[0]?.gate_decision_refs.length).toBeGreaterThan(0)
    expect(denied.attempts[0]?.error_code).toBe('PRE_RUN_GATE_BLOCKED')
    expect(dispatches).toBe(0)
    expect(await new ProcessRepository(blocked.basePath).list()).toEqual([])

    const revealed = await make({
      resolveGateSurface: async () => ({ surfaceClass: 'sealed', revealState: 'revealed' }),
      evaluatePreGates: gateEvaluator,
      dispatch: async (_model, options) => {
        dispatches++
        return { stepId: options.stepId, runId: options.runId, command: 'sh', args: [], cwd: revealed.basePath }
      },
    })
    const allowed = await revealed.service.runAndWait(cmd, context)
    expect(allowed.run.status).toBe('successful')
    expect(dispatches).toBe(1)
  }, 30_000)

  test('input manifest reference stays null when preparation is unavailable or fails', async () => {
    for (const prepareArtifacts of [undefined, async () => { throw new Error('prepare failed') }]) {
      let spawns = 0
      const { service } = await make({
        prepareArtifacts,
        runStep: async () => { spawns++; throw new Error('must not spawn') },
      })
      const out = await service.runAndWait(cmd, context)
      expect(out.attempts[0]?.input_manifest_ref).toBeNull()
      expect(out.attempts[0]?.status).toBe('failed')
      expect(spawns).toBe(0)
    }
  }, 30_000)

  test('exact approval recording receives the run policy snapshot and is not duplicated on replay', async () => {
    const recorded: string[] = []
    const { service } = await make({
      loadPolicy: async () => PolicyConfigSchema.parse({ mode: 'SAFE', side_effect_mode: 'free' }),
      recordApproval: async input => { recorded.push(input.policySnapshotHash) },
    })
    const first = await service.runAndWait(cmd, context)
    await service.runAndWait(cmd, context)
    expect(recorded).toEqual([first.run.policy_snapshot_hash])
  }, 30_000)

  test('exact SAFE approval is consumed before any process record or spawn', async () => {
    const order: string[] = []
    const exactPolicy = PolicyConfigSchema.parse({ mode: 'SAFE', side_effect_mode: 'free' })
    let approvals: Approval[] = []
    const noConfirmContext = { ...context, policyConfirmed: false }
    const { basePath, service } = await make({
      loadPolicy: async () => exactPolicy,
      readApprovals: async () => approvals,
      consumeApproval: async input => {
        order.push(`consume:${input.approvalId}`)
        return {
          ...approvals[0]!,
          consumed_at: input.consumedAt,
          consumed_by: input.consumedBy,
        }
      },
      startProcess: async config => {
        order.push(`start:${config.processId}`)
        return {
          processId: config.processId!,
          pid: 333,
          result: Promise.resolve(rawResult()),
          cancel: async signal => ({
            success: true,
            signal: signal ?? 'SIGTERM',
            escalated: false,
          }),
        } satisfies RunningProcessHandle
      },
      runStep: async () => { throw new Error('compatibility runner must not be used') },
    } as Partial<RuntimeServiceDependencies> & {
      startProcess: (config: Parameters<NonNullable<RuntimeServiceDependencies['startProcess']>>[0]) => Promise<RunningProcessHandle>
    })
    const digest = executableSubjectDigest({ command: 'sh', args: [], cwd: basePath }, basePath, exactPolicy)
    approvals = [{
      id: 'approval-exact-consume',
      action_type: 'run',
      target_ref: 'step:x',
      requested_by: 'reviewer',
      status: 'approved',
      approved_by: 'reviewer',
      approved_at: '2026-01-01T00:00:00.000Z',
      notes: null,
      subject_digest: digest,
      payload_ref: digest,
      policy_ref: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      consumed_at: null,
      consumed_by: null,
    }]

    const out = await service.runAndWait(cmd, noConfirmContext)
    expect(out.run.status).toBe('successful')
    expect(order).toEqual([`consume:${approvals[0]!.id}`, `start:${out.attempts[0]!.process_id}`])
    expect(await new ProcessRepository(basePath).list()).toHaveLength(1)
  }, 30_000)

  test('exact SAFE approval consumption failure stops before any process record or spawn', async () => {
    let spawns = 0
    const exactPolicy = PolicyConfigSchema.parse({ mode: 'SAFE', side_effect_mode: 'free' })
    let approvals: Approval[] = []
    const noConfirmContext = { ...context, policyConfirmed: false }
    const { basePath, service } = await make({
      loadPolicy: async () => exactPolicy,
      readApprovals: async () => approvals,
      consumeApproval: async () => { throw new Error('approval already consumed elsewhere') },
      startProcess: async () => {
        spawns++
        throw new Error('must not spawn')
      },
      runStep: async () => { throw new Error('compatibility runner must not be used') },
    } as Partial<RuntimeServiceDependencies> & {
      startProcess: (config: Parameters<NonNullable<RuntimeServiceDependencies['startProcess']>>[0]) => Promise<RunningProcessHandle>
    })
    const digest = executableSubjectDigest({ command: 'sh', args: [], cwd: basePath }, basePath, exactPolicy)
    approvals = [{
      id: 'approval-exact-fail',
      action_type: 'run',
      target_ref: 'step:x',
      requested_by: 'reviewer',
      status: 'approved',
      approved_by: 'reviewer',
      approved_at: '2026-01-01T00:00:00.000Z',
      notes: null,
      subject_digest: digest,
      payload_ref: digest,
      policy_ref: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      consumed_at: null,
      consumed_by: null,
    }]

    const out = await service.runAndWait(cmd, noConfirmContext)
    expect(out.attempts[0]).toMatchObject({
      status: 'failed',
      error_code: 'APPROVAL_CONSUMPTION_FAILED',
      error_message: 'approval already consumed elsewhere',
      process_id: null,
    })
    expect(await new ProcessRepository(basePath).list()).toEqual([])
    expect(spawns).toBe(0)
  }, 30_000)

  test('confirmed SAFE execution records only when payload and policy lack an exact approval', async () => {
    const existingPolicy = PolicyConfigSchema.parse({ mode: 'SAFE', side_effect_mode: 'free' })
    const approval = (subjectDigest: string): Approval => ({
      id: 'approval-1', action_type: 'run', target_ref: 'step:x', requested_by: 't', status: 'approved',
      approved_by: 't', approved_at: '2026-01-01T00:00:00.000Z', notes: null, subject_digest: subjectDigest,
      payload_ref: subjectDigest,
      policy_ref: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    })

    let exactApprovals: Approval[] = []
    const exactRecorded: string[] = []
    const exact = await make({
      loadPolicy: async () => existingPolicy,
      readApprovals: async () => exactApprovals,
      recordApproval: async input => { exactRecorded.push(executableSubjectDigest(input.payload, input.basePath, input.policy)) },
    })
    const originalPayload = { command: 'sh', args: [], cwd: exact.basePath }
    exactApprovals = [approval(executableSubjectDigest(originalPayload, exact.basePath, existingPolicy))]
    await exact.service.runAndWait(cmd, context)
    expect(exactRecorded).toEqual([])

    let changedPayloadApprovals: Approval[] = []
    const changedPayloadRecorded: string[] = []
    const changedPayload = await make({
      loadPolicy: async () => existingPolicy,
      readApprovals: async () => changedPayloadApprovals,
      dispatch: async (_model, options) => ({ stepId: options.stepId, runId: options.runId, command: 'sh', args: ['changed'], cwd: changedPayload.basePath }),
      recordApproval: async input => { changedPayloadRecorded.push(executableSubjectDigest(input.payload, input.basePath, input.policy)) },
    })
    changedPayloadApprovals = [approval(executableSubjectDigest({ command: 'sh', args: [], cwd: changedPayload.basePath }, changedPayload.basePath, existingPolicy))]
    await changedPayload.service.runAndWait(cmd, context)
    expect(changedPayloadRecorded).toEqual([
      executableSubjectDigest({ command: 'sh', args: ['changed'], cwd: changedPayload.basePath }, changedPayload.basePath, existingPolicy),
    ])

    const changedPolicy = PolicyConfigSchema.parse({ mode: 'SAFE', side_effect_mode: 'approved_only' })
    let changedPolicyApprovals: Approval[] = []
    const changedPolicyRecorded: string[] = []
    const policyChanged = await make({
      loadPolicy: async () => changedPolicy,
      readApprovals: async () => changedPolicyApprovals,
      recordApproval: async input => { changedPolicyRecorded.push(executableSubjectDigest(input.payload, input.basePath, input.policy)) },
    })
    changedPolicyApprovals = [approval(executableSubjectDigest({ command: 'sh', args: [], cwd: policyChanged.basePath }, policyChanged.basePath, existingPolicy))]
    await policyChanged.service.runAndWait(cmd, context)
    expect(changedPolicyRecorded).toEqual([
      executableSubjectDigest({ command: 'sh', args: [], cwd: policyChanged.basePath }, policyChanged.basePath, changedPolicy),
    ])
  }, 30_000)

  test('verified controller timeout produces a timed_out attempt and exited process evidence', async () => {
    const saved: RunResult[] = []
    const { basePath, service } = await make({
      startProcess: async config => ({
        processId: config.processId!,
        pid: 322,
        result: Promise.resolve(rawResult({
          exitCode: null,
          signal: 'SIGKILL',
          status: 'TIMEOUT',
          stderr: 'timed out',
        })),
        cancel: async signal => ({
          success: true,
          signal: signal ?? 'SIGTERM',
          escalated: true,
        }),
      }),
      runStep: async () => { throw new ProcessTimeoutError('compatibility runner used', 5) },
      saveArtifacts: async (_basePath, result) => {
        saved.push(result)
        return 'artifact'
      },
    } as Partial<RuntimeServiceDependencies> & {
      startProcess: (config: Parameters<NonNullable<RuntimeServiceDependencies['startProcess']>>[0]) => Promise<RunningProcessHandle>
    })
    const out = await service.runAndWait(cmd, context)
    expect(out.attempts[0]).toMatchObject({
      status: 'timed_out',
      artifact_manifest_ref: `.threados/runs/${out.run.id}/surfaces/thread-x/artifact.manifest.json`,
    })
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ status: 'TIMEOUT', exitCode: null, stderr: 'timed out' })
    expect(out.run.status).toBe('failed')
    expect((await new ProcessRepository(basePath).list())[0]).toMatchObject({
      status: 'exited',
      pid: 322,
      exit_code: null,
      signal: 'SIGKILL',
    })
    expect((await new CommandRepository(basePath).list())[0]?.status).toBe('failed')
  }, 30_000)

  test('hosted shell guard fails before dispatch/process while an allowed local shell runs', async () => {
    let dispatches = 0
    const blocked = await make({
      allowModelExecution: () => ({ allowed: false, errorCode: 'SHELL_MODEL_DISABLED', reason: 'Shell execution is disabled in hosted mode' }),
      dispatch: async () => { dispatches++; throw new Error('must not dispatch') },
    })
    const denied = await blocked.service.runAndWait(cmd, context)
    expect(denied.attempts[0]?.error_code).toBe('SHELL_MODEL_DISABLED')
    expect(dispatches).toBe(0)
    expect(await new ProcessRepository(blocked.basePath).list()).toEqual([])

    const local = await make({
      allowModelExecution: () => ({ allowed: true }),
      dispatch: async (_model, options) => {
        dispatches++
        return { stepId: options.stepId, runId: options.runId, command: 'sh', args: [], cwd: local.basePath }
      },
    })
    expect((await local.service.runAndWait(cmd, context)).run.status).toBe('successful')
    expect(dispatches).toBe(1)
  }, 30_000)
})

import { randomUUID } from 'crypto'
import { realpath } from 'fs/promises'
import { resolve } from 'path'
import { consumeApproval, readApprovals } from '../approvals/repository'
import { recordConsumedApprovalLifecycle } from '../approvals/runtime'
import { appendGateDecision } from '../gates/repository'
import { evaluateStepCompletionGates, evaluateStepGates, evaluateWorkspaceGates } from '../gates/engine'
import { approvalMatchesExecutableSubject, enforceExecutablePayload, executableSubjectDigest } from '../policy/executable'
import { PolicyEngine } from '../policy/engine'
import { validatePromptExists } from '../prompts/manager'
import { saveRunArtifacts, writeCompiledPrompt, writeInputManifest } from '../runner/artifacts'
import { dispatch } from '../runner/dispatch'
import { compilePrompt } from '../runner/prompt-compiler'
import { startProcess } from '../runner/wrapper'
import { validateDAG } from '../sequence/dag'
import { readSequence } from '../sequence/parser'
import { readRuntimeEventLog, readRuntimeEventLogAtPath } from '../thread-surfaces/runtime-event-log'
import { appendTraceEvent } from '../traces/writer'
import { readThreadSurfaceState } from '../thread-surfaces/repository'
import { allowShellModel } from '../hosted'
import { AttemptRepository } from './attempt-repository'
import { CommandRepository } from './command-repository'
import { ProcessRepository } from './process-repository'
import { createRuntimeProjections } from './projections'
import { reconcileCanonicalRuntime } from './recovery'
import { RunRepository } from './run-repository'
import { SequentialScheduler } from './scheduler'
import { ThreadOSRuntimeService } from './service'
import type { RuntimeCanonicalWorkspaceEvidence, RuntimeServiceDependencies } from './service-types'
import type { StepAttempt, WorkflowRun } from './schema'
import { createTestCompatibilityStartProcess } from './test-compatibility'
import type { RunnerConfig, RunResult } from '../runner/wrapper'
import { loadWorkspaceConfig } from '../workspaces/config'
import { readLocalWorkspace } from '../local-first/workspace'
import { captureSnapshot, inspectCanonicalManifest } from '../workspaces/snapshot'
import { SurfaceWorkspaceManager, SurfaceWorkspaceTraceError } from '../workspaces/manager'
import { WorkspaceRepository } from '../workspaces/repository'
import { classifyAttemptSideEffect, resolveWorkspaceDispatchContext } from './workspace-planner'
import { runWorkspaceBootstrap } from '../workspaces/bootstrap'
import { resolveExistingPathWithinRoot, resolvePathWithinRoot } from '../security/safe-path'
import { writeFileAtomic } from '../fs/atomic'
import { SnapshotRepository } from '../workspaces/snapshot-repository'
import { captureChangeSet } from '../changesets/capture'
import { validateAttemptCandidate } from '../changesets/validation'
import { ChangeSetOperations } from '../changesets/operations'
import { resolveRuntimeDataRoot, resolveWorkspaceRuntimePaths } from '../workspaces/paths'
import { buildExclusionPolicy } from '../workspaces/exclusions'
import { hashCanonicalJson } from '../workspaces/hash'
import { readTextFileNoFollow } from '../security/safe-io'
import { ValidationPolicyIntentSchema } from '../changesets/validation-schema'
import {
  CanonicalPreconditionSchema,
  CanonicalWriteAttributionError,
  classifyCanonicalManifestChange,
  readCanonicalPrecondition,
  readCanonicalProjectWrites,
} from './canonical-write-journal'

export interface RuntimeFactoryOptions {
  dependencies?: Partial<RuntimeServiceDependencies>
  reconcile?: RuntimeServiceDependencies['reconcile']
  /** Explicit test-only bridge for legacy API/CLI terminal-runner fixtures. */
  testCompatibility?: {
    runStep(config: RunnerConfig): Promise<RunResult>
  }
}

const instances = new Map<string, Promise<ThreadOSRuntimeService>>()

interface CanonicalEvidenceInput extends Omit<RuntimeCanonicalWorkspaceEvidence, 'evidenceRef'> {
  basePath: string
  run: WorkflowRun
  attempt: StepAttempt
  now(): string
}

async function persistCanonicalWorkspaceEvidence(input: CanonicalEvidenceInput): Promise<RuntimeCanonicalWorkspaceEvidence> {
  const { basePath, run, attempt, preHash, postHash, classification, now } = input
  const relativeRef = `.threados/runs/${run.id}/attempts/${attempt.id}/canonical-precondition.json`
  const attemptRoot = await resolveExistingPathWithinRoot(
    basePath, '.threados', 'runs', run.id, 'attempts', attempt.id,
  )
  const evidencePath = await resolvePathWithinRoot(attemptRoot, 'canonical-precondition.json')
  await writeFileAtomic(evidencePath, `${JSON.stringify({
    schema_version: 1,
    workflow_run_id: run.id,
    attempt_id: attempt.id,
    pre_hash: preHash,
    post_hash: postHash,
    classification,
    observed_at: now(),
  }, null, 2)}\n`, { allowedRoot: basePath })
  await appendTraceEvent(basePath, run.id, {
    ts: now(),
    run_id: run.id,
    surface_id: attempt.surface_id,
    actor: 'threados-runtime',
    event_type: 'policy-checked',
    payload_ref: relativeRef,
    policy_ref: run.policy_snapshot_hash,
  })
  return { preHash, postHash, classification, evidenceRef: relativeRef }
}

function defaults(basePath: string): RuntimeServiceDependencies {
  const now = () => new Date().toISOString()
  const workspaceManagers = new Map<string, SurfaceWorkspaceManager>()
  const managerFor = async (): Promise<SurfaceWorkspaceManager> => {
    const workspace = await readLocalWorkspace(basePath)
    const existing = workspaceManagers.get(workspace.id)
    if (existing) return existing
    const manager = new SurfaceWorkspaceManager({
      canonicalRoot: basePath,
      runtimeDataRoot: workspace.runtimeDataRoot,
      localWorkspaceId: workspace.id,
      actor: 'threados-runtime',
    })
    workspaceManagers.set(workspace.id, manager)
    return manager
  }
  return {
    now,
    newId: prefix => `${prefix}-${randomUUID()}`,
    loadSequence: readSequence,
    loadPolicy: async path => (await PolicyEngine.load(path)).getConfig(),
    validateSequence: validateDAG,
    validatePrompt: validatePromptExists,
    compilePrompt: async input => {
      const { sequence, step, runId, executionRoot, workspaceContext, logicalWorkingDirectory,
        includeDependencyArtifacts, runtimeEventLogPath, rawPrompt } = input
      if (step.model === 'shell') return rawPrompt
      return await compilePrompt({
        stepId: step.id, step, rawPrompt, sequence, basePath,
        executionRoot,
        workspaceContext,
        logicalWorkingDirectory,
        includeDependencyArtifacts,
        dependencyArtifactRunId: runId,
        maxTokens: step.model === 'claude-code' ? 8000 : 4000,
        runtimeEventLogPath,
        runtimeEventEmitterCommand: 'thread event',
      })
    },
    prepareRunWorkspace: async ({ run }) => {
      const [config, localWorkspace] = await Promise.all([
        loadWorkspaceConfig(basePath),
        readLocalWorkspace(basePath),
      ])
      const captured = await captureSnapshot({
        canonicalRoot: basePath,
        runtimeDataRoot: localWorkspace.runtimeDataRoot,
        localWorkspaceId: localWorkspace.id,
        workflowRunId: run.id,
        config,
        actor: 'threados-runtime',
      })
      const canonicalPreHash = captured.manifest.root_manifest_hash
      const runRoot = await resolveExistingPathWithinRoot(basePath, '.threados', 'runs', run.id)
      const preconditionPath = await resolvePathWithinRoot(runRoot, 'canonical-precondition.json')
      const precondition = CanonicalPreconditionSchema.parse({
        schema_version: 1,
        revision: 0,
        workflow_run_id: run.id,
        snapshot_id: captured.snapshot.id,
        pre_hash: canonicalPreHash,
        captured_at: now(),
        threados_project_write_refs: [],
      })
      await writeFileAtomic(preconditionPath, `${JSON.stringify(precondition, null, 2)}\n`, { allowedRoot: basePath })
      const validationIntentPath = await resolvePathWithinRoot(runRoot, 'validation-policy.json')
      const validationIntent = ValidationPolicyIntentSchema.parse({
        schema_version: 1, workflow_run_id: run.id,
        required_commands: config.validate.length, commands_hash: hashCanonicalJson(config.validate),
      })
      await writeFileAtomic(validationIntentPath, `${JSON.stringify(validationIntent, null, 2)}\n`, { allowedRoot: basePath })
      return {
        snapshotId: captured.snapshot.id,
        snapshotManifestRef: captured.snapshot.manifest_ref
          ?? `.threados/snapshots/${captured.snapshot.id}/manifest.json`,
        canonicalPreHash,
      }
    },
    prepareAttemptWorkspace: async ({ run, attempt, step, snapshotId }) => {
      const config = await loadWorkspaceConfig(basePath)
      const manager = await managerFor()
      let ready
      try {
        ready = await manager.provision({
          workflowRunId: run.id,
          attemptId: attempt.id,
          surfaceId: attempt.surface_id,
          snapshotId,
          config,
          requestedIsolation: 'THREADOS_SCOPED',
        })
      } catch (error) {
        if (error instanceof SurfaceWorkspaceTraceError) {
          await manager.finalize(error.workspace.id, { outcome: 'failed' }).catch(() => undefined)
        }
        throw error
      }
      try {
        const siblings = (await manager.list())
          .filter(candidate => candidate.id !== ready.id
            && ['ready', 'active', 'frozen', 'retained'].includes(candidate.status))
          .map(candidate => candidate.root_path)
        const context = await resolveWorkspaceDispatchContext({
          state: await manager.inspect(ready.id),
          expected: {
            workflowRunId: run.id,
            attemptId: attempt.id,
            surfaceId: attempt.surface_id,
            snapshotId,
          },
          canonicalRoot: basePath,
          sealedSiblingRoots: siblings,
          stepId: step.id,
        })
        const repository = new WorkspaceRepository(basePath)
        await repository.update(ready.id, ready.revision, current => ({
          ...current,
          status: 'active',
        }))
        return {
          context,
          manifestHash: ready.manifest_hash!,
          workspaceManifestRef: `.threados/workspaces/records/${ready.id}.json`,
        }
      } catch (error) {
        await manager.finalize(ready.id, { outcome: 'failed' }).catch(() => undefined)
        throw error
      }
    },
    bootstrapWorkspace: async ({ run, attempt, policy, context, workspace, execute }) => {
      const config = await loadWorkspaceConfig(basePath)
      await runWorkspaceBootstrap({
        commands: config.bootstrap,
        canonicalRoot: basePath,
        context: workspace.context,
        evaluatePolicy: payload => enforceExecutablePayload(payload, policy, context.policyConfirmed),
        execute,
        writeArtifact: async artifact => {
          const attemptRoot = await resolveExistingPathWithinRoot(
            basePath,
            '.threados',
            'runs',
            run.id,
            'attempts',
            attempt.id,
          )
          const path = await resolvePathWithinRoot(attemptRoot, `bootstrap-${artifact.index}.json`)
          await writeFileAtomic(path, `${JSON.stringify(artifact, null, 2)}\n`, { allowedRoot: basePath })
        },
      })
    },
    finalizeAttemptWorkspace: async ({ attempt, workspace }) => {
      const manager = await managerFor()
      const outcome = attempt.status === 'completed'
        ? 'successful'
        : attempt.status === 'needs_review'
          ? 'needs_review'
          : attempt.status === 'cancelled'
            ? 'cancelled_before_write'
            : attempt.status === 'interrupted'
              ? 'interrupted'
              : 'failed'
      await manager.finalize(workspace.context.workspaceId, { outcome })
    },
    captureAttemptChangeSet: async ({ run, attempt, step, workspace }) => {
      const local = await readLocalWorkspace(basePath)
      const runtimeDataRoot = await resolveRuntimeDataRoot({ canonicalRoot: basePath, override: local.runtimeDataRoot })
      const paths = resolveWorkspaceRuntimePaths(runtimeDataRoot, local.id, await realpath(basePath))
      const [record, snapshot, manifest, config] = await Promise.all([
        new WorkspaceRepository(basePath).get(workspace.context.workspaceId),
        new SnapshotRepository(basePath).get(workspace.context.snapshotId),
        new SnapshotRepository(basePath).getManifest(workspace.context.snapshotId),
        loadWorkspaceConfig(basePath),
      ])
      if (!record || !snapshot || !manifest || record.root_path !== workspace.context.cwd) {
        throw new Error('CHANGE_SET_WORKSPACE_MISMATCH')
      }
      const exclusionPolicy = await buildExclusionPolicy({
        canonicalRoot: await realpath(basePath), config,
        alwaysExcludedRoots: [runtimeDataRoot],
      })
      const validationIntentPath = await resolveExistingPathWithinRoot(basePath,
        '.threados', 'runs', run.id, 'validation-policy.json')
      const validationIntent = ValidationPolicyIntentSchema.parse(JSON.parse(await readTextFileNoFollow(validationIntentPath)))
      if (validationIntent.workflow_run_id !== run.id
        || validationIntent.commands_hash !== hashCanonicalJson(config.validate)
        || validationIntent.required_commands !== config.validate.length) {
        throw new Error('CHANGE_SET_VALIDATION_POLICY_CHANGED')
      }
      const captured = await captureChangeSet({
        canonicalRoot: basePath, runtimeDataRoot, namespace: paths.workspaceNamespace,
        workflowRunId: run.id, attemptId: attempt.id, stepId: step.id, surfaceId: attempt.surface_id,
        agentRef: attempt.agent_ref, workspace: record, snapshot, baselineManifest: manifest,
        exclusionPolicy,
        maxFiles: config.workspace.max_files, maxBytes: config.workspace.max_bytes_each,
        pathScopes: step.path_scopes ?? undefined,
        outputContractConfigured: Boolean(step.output_contract_ref || step.completion_contract),
        validationCommandsRequired: validationIntent.required_commands,
        createdAt: now(),
      })
      return { id: captured.id, captured: captured.status === 'captured', pathScopeViolations: captured.path_scope_violations }
    },
    validateAttemptWorkspace: validateAttemptCandidate,
    finalizeAttemptChangeSet: async ({ run, attempt }) => {
      if (attempt.change_set_id) await new ChangeSetOperations(basePath).finalizeEvidence(run.id, attempt.id)
    },
    verifyCanonicalWorkspace: async ({ run, attempt }) => {
      const [config, localWorkspace] = await Promise.all([
        loadWorkspaceConfig(basePath),
        readLocalWorkspace(basePath),
      ])
      const precondition = await readCanonicalPrecondition(basePath, run.id)
      if (precondition.snapshot_id !== run.baseline_snapshot_id) {
        throw new CanonicalWriteAttributionError(`Canonical pre-dispatch snapshot binding is invalid for run ${run.id}`)
      }
      const baseline = await new SnapshotRepository(basePath).getManifest(precondition.snapshot_id)
      if (!baseline || baseline.root_manifest_hash !== precondition.pre_hash) {
        throw new CanonicalWriteAttributionError(`Canonical baseline manifest is unavailable for run ${run.id}`)
      }
      const preHash = precondition.pre_hash
      const inspected = await inspectCanonicalManifest({
        canonicalRoot: basePath,
        runtimeDataRoot: localWorkspace.runtimeDataRoot,
        localWorkspaceId: localWorkspace.id,
        workflowRunId: run.id,
        config,
      })
      const writes = await readCanonicalProjectWrites(
        basePath,
        run.id,
        precondition.threados_project_write_refs,
      )
      const classification = classifyCanonicalManifestChange({
        before: baseline.entries,
        after: inspected.entries,
        writes,
      })
      return await persistCanonicalWorkspaceEvidence({
        basePath, run, attempt, preHash,
        postHash: inspected.rootManifestHash,
        classification, now,
      })
    },
    prepareArtifacts: async ({ basePath: path, runId, surfaceId, step, compiledPrompt, createdAt }) => {
      await writeInputManifest(path, runId, surfaceId, {
        stepId: step.id, runId, surfaceId, promptRef: step.prompt_ref?.path ?? step.prompt_file,
        dependsOn: step.depends_on, inputContractRef: step.input_contract_ref ?? null, createdAt,
      })
      await writeCompiledPrompt(path, runId, surfaceId, compiledPrompt)
    },
    resolveGateSurface: async ({ basePath: path, surfaceId }) => {
      const state = await readThreadSurfaceState(path)
      const surface = state.threadSurfaces.find(candidate => candidate.id === surfaceId)
      return { surfaceClass: surface?.surfaceClass ?? 'shared', revealState: surface?.revealState ?? null }
    },
    allowModelExecution: ({ step }) => step.model !== 'shell' || allowShellModel()
      ? { allowed: true }
      : { allowed: false, errorCode: 'SHELL_MODEL_DISABLED', reason: 'Shell execution is disabled in hosted mode' },
    dispatch,
    startProcess,
    saveArtifacts: async (path, result, input) => await saveRunArtifacts(path, result, {
      surfaceId: input.surfaceId, compiledPrompt: input.compiledPrompt,
      outputContractRef: input.step.output_contract_ref, completionContract: input.step.completion_contract,
    }),
    readRuntimeEvents: async (path, runId, stepId, runtimeEventLogPath, executionRoot) => (
      runtimeEventLogPath
        ? await readRuntimeEventLogAtPath(runtimeEventLogPath, executionRoot)
        : await readRuntimeEventLog(path, runId, stepId)
    ).events,
    readApprovals,
    consumeApproval: async ({ basePath: path, runId, approvalId, targetRefs, subjectDigest, consumedAt, consumedBy }) => await consumeApproval(
      path,
      runId,
      approvalId,
      { targetRefs, subjectDigest, consumedAt, consumedBy },
    ),
    evaluatePreGates: input => {
      const decisions = evaluateStepGates(input.step, input.sequence.steps, input.sequence.gates, {
        policyMode: input.policy.mode,
        sideEffectMode: input.approvalPresent ? 'free' : input.policy.side_effect_mode,
        crossSurfaceReads: input.policy.cross_surface_reads,
        surfaceClass: input.surfaceClass,
        revealState: input.revealState,
        isDependency: true,
        inputManifestPresent: true,
        approvalPresent: input.approvalPresent,
      })
      const workspaceMode = (input.step as typeof input.step & { workspace_mode?: 'auto' | 'isolated' }).workspace_mode
      const sideEffectClass = classifyAttemptSideEffect({
        model: input.step.model,
        declaredSideEffectClass: input.step.side_effect_class,
      })
      if (workspaceMode === 'isolated' || sideEffectClass === 'write' || sideEffectClass === 'execute') {
        decisions.push(...evaluateWorkspaceGates(input.step.id, {
          snapshotPresent: input.snapshotPresent,
          snapshotVerified: input.snapshotVerified,
          workspacePresent: input.workspacePresent,
          workspaceReady: input.workspaceReady,
          workspaceManifestVerified: input.workspaceManifestVerified,
          snapshotManifestRef: input.snapshotManifestRef,
          workspaceManifestRef: input.workspaceManifestRef,
        }))
      }
      return decisions
    },
    evaluateCompletionGates: ({ step, result: _result, artifactManifestPresent }) => evaluateStepCompletionGates(step, {
      artifactManifestPresent,
      outputSchemaValid: !step.output_contract_ref,
      completionContractSatisfied: !step.completion_contract,
    }),
    persistGateDecisions: async (path, runId, _surfaceId, decisions) => {
      for (const decision of decisions) await appendGateDecision(path, runId, decision)
    },
    enforceBatchPolicy: ({ policy, stepCount, confirmed, basePath: path }) => {
      const engine = new PolicyEngine(policy)
      const fanout = engine.validate({ type: 'fanout', fanout_count: stepCount })
      if (!fanout.allowed) return fanout
      const concurrent = engine.validate({ type: 'concurrent', concurrent_count: 1 })
      if (!concurrent.allowed) return concurrent
      const result = engine.validate({ type: 'run_command', command: stepCount > 1 ? `threados batch run (${stepCount} steps)` : 'threados run', cwd: path })
      return result.confirmation_required && confirmed ? { ...result, confirmation_required: false } : result
    },
    enforceExecutablePolicy: ({ payload, policy, confirmed, approvals, targetRefs, basePath: path }) => {
      const digest = executableSubjectDigest(payload, path, policy)
      const exactApproval = approvals.some(approval => approvalMatchesExecutableSubject(approval, targetRefs, digest))
      return enforceExecutablePayload(payload, policy, confirmed || exactApproval)
    },
    recordApproval: async ({ basePath: path, runId, context, targetRef, payload, policy, policySnapshotHash }) => {
      const digest = executableSubjectDigest(payload, path, policy)
      await recordConsumedApprovalLifecycle({
        basePath: path, runId, actionType: 'run', targetRef, requestedBy: context.actor,
        consumedBy: `runtime:${context.interface}`,
        resolvedBy: context.actor, actor: `runtime:${context.interface}`,
        notes: 'Confirmation bound to exact executable subject.', payloadRef: digest,
        policyRef: policySnapshotHash, subjectDigest: digest,
      })
    },
    appendTrace: appendTraceEvent,
    reconcile: async (path, context) => await reconcileCanonicalRuntime(path, {
      ...context,
      workspaceManager: await managerFor(),
    }),
    projections: createRuntimeProjections(basePath),
  }
}

export async function getThreadOSRuntimeService(basePath: string, options: RuntimeFactoryOptions = {}): Promise<ThreadOSRuntimeService> {
  const canonical = await realpath(resolve(basePath))
  const existing = instances.get(canonical)
  if (existing) return await existing
  const initialization = (async () => {
    const dependencies = { ...defaults(canonical), ...options.dependencies }
    if (options.reconcile) dependencies.reconcile = options.reconcile
    if (options.testCompatibility) {
      dependencies.startProcess = createTestCompatibilityStartProcess(
        options.testCompatibility.runStep,
      )
    }
    await dependencies.reconcile?.(canonical)
    return new ThreadOSRuntimeService({
      basePath: canonical, scheduler: new SequentialScheduler(), dependencies,
      repositories: {
        runs: new RunRepository(canonical), attempts: new AttemptRepository(canonical),
        processes: new ProcessRepository(canonical), commands: new CommandRepository(canonical),
      },
    })
  })()
  instances.set(canonical, initialization)
  try {
    return await initialization
  } catch (error) {
    instances.delete(canonical)
    throw error
  }
}

export function clearRuntimeServiceFactoryForTests(): void {
  instances.clear()
}

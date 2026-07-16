import { randomUUID } from 'crypto'
import { realpath } from 'fs/promises'
import { resolve } from 'path'
import { readApprovals } from '../approvals/repository'
import { recordApprovedApprovalLifecycle } from '../approvals/runtime'
import { appendGateDecision } from '../gates/repository'
import { evaluateStepCompletionGates, evaluateStepGates } from '../gates/engine'
import { approvalMatchesExecutableSubject, enforceExecutablePayload, executableSubjectDigest } from '../policy/executable'
import { PolicyEngine } from '../policy/engine'
import { readPrompt, validatePromptExists } from '../prompts/manager'
import { getRuntimeEventLogPath, saveRunArtifacts, writeCompiledPrompt, writeInputManifest } from '../runner/artifacts'
import { dispatch } from '../runner/dispatch'
import { compilePrompt } from '../runner/prompt-compiler'
import { runStep } from '../runner/wrapper'
import { validateDAG } from '../sequence/dag'
import { readSequence } from '../sequence/parser'
import { readRuntimeEventLog } from '../thread-surfaces/runtime-event-log'
import { appendTraceEvent } from '../traces/writer'
import { AttemptRepository } from './attempt-repository'
import { CommandRepository } from './command-repository'
import { ProcessRepository } from './process-repository'
import { createRuntimeProjections } from './projections'
import { RunRepository } from './run-repository'
import { SequentialScheduler } from './scheduler'
import { ThreadOSRuntimeService } from './service'
import type { RuntimeServiceDependencies } from './service-types'

export interface RuntimeFactoryOptions {
  dependencies?: Partial<RuntimeServiceDependencies>
  reconcile?: (basePath: string) => Promise<void>
}

const instances = new Map<string, Promise<ThreadOSRuntimeService>>()

function defaults(basePath: string): RuntimeServiceDependencies {
  return {
    now: () => new Date().toISOString(),
    newId: prefix => `${prefix}-${randomUUID()}`,
    loadSequence: readSequence,
    loadPolicy: async path => (await PolicyEngine.load(path)).getConfig(),
    validateSequence: validateDAG,
    validatePrompt: validatePromptExists,
    compilePrompt: async ({ sequence, step, runId }) => {
      const rawPrompt = await readPrompt(basePath, step.id)
      if (step.model === 'shell') return rawPrompt
      return await compilePrompt({
        stepId: step.id, step, rawPrompt, sequence, basePath,
        maxTokens: step.model === 'claude-code' ? 8000 : 4000,
        runtimeEventLogPath: getRuntimeEventLogPath(basePath, runId, step.id),
        runtimeEventEmitterCommand: 'thread event',
      })
    },
    prepareArtifacts: async ({ basePath: path, runId, surfaceId, step, compiledPrompt, createdAt }) => {
      await writeInputManifest(path, runId, surfaceId, {
        stepId: step.id, runId, surfaceId, promptRef: step.prompt_ref?.path ?? step.prompt_file,
        dependsOn: step.depends_on, inputContractRef: step.input_contract_ref ?? null, createdAt,
      })
      await writeCompiledPrompt(path, runId, surfaceId, compiledPrompt)
    },
    dispatch,
    runStep,
    saveArtifacts: async (path, result, input) => await saveRunArtifacts(path, result, {
      surfaceId: input.surfaceId, compiledPrompt: input.compiledPrompt,
      outputContractRef: input.step.output_contract_ref, completionContract: input.step.completion_contract,
    }),
    readRuntimeEvents: async (path, runId, stepId) => (await readRuntimeEventLog(path, runId, stepId)).events,
    readApprovals,
    evaluatePreGates: ({ step, sequence, policy, approvalPresent }) => evaluateStepGates(step, sequence.steps, sequence.gates, {
      policyMode: policy.mode, sideEffectMode: policy.side_effect_mode, crossSurfaceReads: policy.cross_surface_reads,
      surfaceClass: 'shared', revealState: null, isDependency: true, inputManifestPresent: true, approvalPresent,
    }),
    evaluateCompletionGates: ({ step, result, artifactManifestPresent }) => evaluateStepCompletionGates(step, {
      artifactManifestPresent,
      outputSchemaValid: step.output_contract_ref ? result.status === 'SUCCESS' : true,
      completionContractSatisfied: step.completion_contract ? result.status === 'SUCCESS' : true,
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
    recordApproval: async ({ basePath: path, runId, context, targetRef, payload, policy }) => {
      const digest = executableSubjectDigest(payload, path, policy)
      await recordApprovedApprovalLifecycle({
        basePath: path, runId, actionType: 'run', targetRef, requestedBy: context.actor,
        resolvedBy: context.actor, actor: `runtime:${context.interface}`,
        notes: 'Confirmation bound to exact executable subject.', payloadRef: digest, policyRef: digest, subjectDigest: digest,
      })
    },
    appendTrace: appendTraceEvent,
    projections: createRuntimeProjections(basePath),
  }
}

export async function getThreadOSRuntimeService(basePath: string, options: RuntimeFactoryOptions = {}): Promise<ThreadOSRuntimeService> {
  const canonical = await realpath(resolve(basePath))
  const existing = instances.get(canonical)
  if (existing) return await existing
  const initialization = (async () => {
    await options.reconcile?.(canonical)
    const dependencies = { ...defaults(canonical), ...options.dependencies }
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

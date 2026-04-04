import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  auditLog,
  checkPolicy,
  handleError,
  jsonError,
  requireRequestSession,
  type PolicyCheckResult,
} from '@/lib/api-helpers'
import { getBasePath } from '@/lib/config'
import { allowShellModel } from '@/lib/hosted'
import { readPrompt, validatePromptExists } from '@/lib/prompts/manager'
import { dispatch, exitCodeToStatus } from '@/lib/runner/dispatch'
import { getRuntimeEventLogPath, saveRunArtifacts } from '@/lib/runner/artifacts'
import { compilePrompt } from '@/lib/runner/prompt-compiler'
import { runStep, type RunnerConfig } from '@/lib/runner/wrapper'
import { topologicalSort, validateDAG } from '@/lib/sequence/dag'
import { readSequence, writeSequence } from '@/lib/sequence/parser'
import type { Sequence, Step } from '@/lib/sequence/schema'
import { ROOT_THREAD_SURFACE_ID } from '@/lib/thread-surfaces/constants'
import { completeRun, createReplacementRun, createRootThreadSurfaceRun } from '@/lib/thread-surfaces/mutations'
import { provisionAllChildSequences } from '@/lib/thread-surfaces/provision-child-sequence'
import { readThreadSurfaceState, writeThreadSurfaceState } from '@/lib/thread-surfaces/repository'
import { readRuntimeEventLog, type RuntimeDelegationEvent } from '@/lib/thread-surfaces/runtime-event-log'
import { applyRateLimit } from '@/lib/rate-limit'
import { PolicyEngine } from '@/lib/policy/engine'
import { recordApprovedApprovalLifecycle } from '@/lib/approvals/runtime'
import {
  beginStepRunIfSurfaceExists,
  finalizeStepRunWithRuntimeEvents,
  type StepRunScope,
} from '@/lib/thread-surfaces/step-run-runtime'

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
const THREADOS_EVENT_EMITTER_COMMAND = 'thread event'

const BodySchema = z.union([
  z.object({ stepId: z.string() }),
  z.object({ mode: z.literal('runnable') }),
  z.object({ groupId: z.string() }),
]).and(z.object({ confirmPolicy: z.boolean().optional() }))

type RunRequestBody = z.infer<typeof BodySchema>

interface RunRouteRuntime {
  dispatch: typeof dispatch
  runStep: typeof runStep
  saveRunArtifacts: typeof saveRunArtifacts
}

declare global {
  var __THREADOS_RUN_ROUTE_RUNTIME__: RunRouteRuntime | undefined
}

function getRunRouteRuntime(): RunRouteRuntime {
  return globalThis.__THREADOS_RUN_ROUTE_RUNTIME__ ?? {
    dispatch,
    runStep,
    saveRunArtifacts,
  }
}

function getRunnableSteps(sequence: Sequence): Step[] {
  const done = new Set([
    ...sequence.steps.filter(step => step.status === 'DONE').map(step => step.id),
    ...sequence.gates.filter(gate => gate.status === 'APPROVED').map(gate => gate.id),
  ])
  return sequence.steps.filter(step => step.status === 'READY' && step.depends_on.every(dep => done.has(dep)))
}

function resolveTargetSteps(sequence: Sequence, body: RunRequestBody): Step[] {
  if ('stepId' in body) {
    const step = sequence.steps.find(candidate => candidate.id === body.stepId)
    return step ? [step] : []
  }

  if ('groupId' in body) {
    return getRunnableSteps(sequence).filter(step => step.group_id === body.groupId)
  }

  const runnableSteps = getRunnableSteps(sequence)
  const runnableById = new Map(runnableSteps.map(step => [step.id, step]))
  return topologicalSort(sequence)
    .map(stepId => runnableById.get(stepId) ?? null)
    .filter((step): step is Step => step != null)
}

function policyStatusToHttp(result: PolicyCheckResult): { code: string; status: number } {
  return result.confirmationRequired
    ? { code: 'POLICY_CONFIRMATION_REQUIRED', status: 409 }
    : { code: 'POLICY_DENIED', status: 403 }
}

function targetRefFromRunBody(body: RunRequestBody): string {
  if ('stepId' in body) return `step:${body.stepId}`
  if ('groupId' in body) return `group:${body.groupId}`
  return 'mode:runnable'
}

function commandLineFromRunnerConfig(runnerConfig: RunnerConfig): string {
  return [runnerConfig.command, ...(runnerConfig.args ?? [])].join(' ').trim()
}

async function enforceBatchPolicy(basePath: string, stepCount: number, confirmed: boolean) {
  const fanoutPolicy = await checkPolicy('fanout', { fanoutCount: stepCount })
  if (!fanoutPolicy.allowed) return fanoutPolicy

  const concurrentPolicy = await checkPolicy('concurrent', { concurrentCount: 1 })
  if (!concurrentPolicy.allowed) return concurrentPolicy

  return checkPolicy('run_command', {
    command: stepCount > 1 ? `threados batch run (${stepCount} steps)` : 'threados run',
    cwd: basePath,
    confirmed,
  })
}

async function createRunScopeForRequest(basePath: string, sequenceName: string, runId: string, startedAt: string) {
  const currentState = await readThreadSurfaceState(basePath)
  const executionIndex = currentState.runs.length + 1
  const nextState = currentState.threadSurfaces.some(surface => surface.id === ROOT_THREAD_SURFACE_ID)
    ? createReplacementRun(currentState, {
        threadSurfaceId: ROOT_THREAD_SURFACE_ID,
        runId,
        startedAt,
        executionIndex,
      }).state
    : createRootThreadSurfaceRun(currentState, {
        surfaceId: ROOT_THREAD_SURFACE_ID,
        surfaceLabel: sequenceName,
        createdAt: startedAt,
        runId,
        startedAt,
        executionIndex,
      }).state

  await writeThreadSurfaceState(basePath, nextState)
}

async function createStepRunScope(basePath: string, step: Step): Promise<{ stepRun: StepRunScope | null }> {
  const currentState = await readThreadSurfaceState(basePath)
  const startedAt = new Date().toISOString()
  const result = beginStepRunIfSurfaceExists(currentState, step, {
    now: startedAt,
    nextRunId: randomUUID(),
    executionIndex: currentState.runs.length + 1,
  })

  if (result.state !== currentState) {
    await writeThreadSurfaceState(basePath, result.state)
  }

  return { stepRun: result.stepRun }
}

async function finalizeStepRunScope(
  basePath: string,
  step: Step,
  stepRuntime: Awaited<ReturnType<typeof createStepRunScope>>,
  success: boolean,
  runtimeEvents: RuntimeDelegationEvent[],
) {
  const currentState = await readThreadSurfaceState(basePath)
  const finalized = finalizeStepRunWithRuntimeEvents(currentState, {
    step,
    stepRun: stepRuntime.stepRun,
    success,
    endedAt: new Date().toISOString(),
    runtimeEvents,
    nextRunId: randomUUID,
    nextEventId: randomUUID,
    nextMergeId: randomUUID,
  })

  if (finalized.stepRun != null) {
    await writeThreadSurfaceState(basePath, finalized.state)
  }

  if (finalized.pendingChildSequences.length > 0) {
    await provisionAllChildSequences(basePath, finalized.pendingChildSequences)
  }
}

async function finalizeRunScope(basePath: string, runId: string, success: boolean, runSummary: string) {
  const currentState = await readThreadSurfaceState(basePath)
  const nextState = completeRun(currentState, {
    runId,
    runStatus: success ? 'successful' : 'failed',
    endedAt: new Date().toISOString(),
    runSummary,
  }).state
  await writeThreadSurfaceState(basePath, nextState)
}

async function executeStep(
  basePath: string,
  sequence: Sequence,
  stepId: string,
  runId: string,
  confirmPolicy: boolean,
) {
  const step = sequence.steps.find(candidate => candidate.id === stepId)
  if (!step) {
    return { success: false, stepId, runId, status: 'FAILED' as const, error: 'Step not found' }
  }

  const stepRuntime = await createStepRunScope(basePath, step)
  const promptPath = step.prompt_file
  const promptExists = await validatePromptExists(basePath, stepId)

  if (!promptExists) {
    step.status = 'FAILED'
    await writeSequence(basePath, sequence)
    await finalizeStepRunScope(basePath, step, stepRuntime, false, []).catch(() => {})
    return {
      success: false,
      stepId,
      runId,
      status: 'FAILED' as const,
      error: `Prompt file not found for step '${stepId}'. Expected: ${promptPath}`,
    }
  }

  try {
    const runtime = getRunRouteRuntime()
    const runtimeEventLogPath = getRuntimeEventLogPath(basePath, runId, stepId)
    const rawPrompt = await readPrompt(basePath, stepId)
    const promptForDispatch = step.model === 'shell'
      ? rawPrompt
      : await compilePrompt({
          stepId,
          step,
          rawPrompt,
          sequence,
          basePath,
          maxTokens: step.model === 'claude-code' ? 8000 : 4000,
          runtimeEventLogPath,
          runtimeEventEmitterCommand: THREADOS_EVENT_EMITTER_COMMAND,
        })

    if (step.model === 'shell' && !allowShellModel()) {
      await finalizeStepRunScope(basePath, step, stepRuntime, false, []).catch(() => {})
      return {
        success: false,
        stepId,
        runId,
        status: step.status,
        error: 'Shell execution is disabled in hosted mode',
      }
    }

    const runnerConfig = await runtime.dispatch(step.model, {
      stepId,
      runId,
      compiledPrompt: promptForDispatch,
      cwd: step.cwd || basePath,
      timeout: step.timeout_ms || DEFAULT_TIMEOUT_MS,
      runtimeEventLogPath,
      runtimeEventEmitterCommand: THREADOS_EVENT_EMITTER_COMMAND,
    })

    const policyResult = await checkPolicy('run_command', {
      command: commandLineFromRunnerConfig(runnerConfig),
      cwd: runnerConfig.cwd,
      confirmed: confirmPolicy,
    })
    if (!policyResult.allowed) {
      await finalizeStepRunScope(basePath, step, stepRuntime, false, []).catch(() => {})
      return {
        success: false,
        stepId,
        runId,
        status: step.status,
        error: policyResult.reason ?? 'Policy denied',
        confirmationRequired: policyResult.confirmationRequired,
      }
    }

    step.status = 'RUNNING'
    await writeSequence(basePath, sequence)

    const result = await runtime.runStep(runnerConfig)
    const artifactPath = await runtime.saveRunArtifacts(basePath, result)
    const runtimeEvents = await readRuntimeEventLog(basePath, runId, stepId)
    step.status = exitCodeToStatus(result.exitCode)
    await writeSequence(basePath, sequence)
    await finalizeStepRunScope(basePath, step, stepRuntime, step.status === 'DONE', runtimeEvents.events)
    return {
      success: result.status === 'SUCCESS',
      stepId,
      runId,
      status: step.status,
      duration: result.duration,
      artifactPath,
    }
  } catch (error) {
    step.status = 'FAILED'
    await writeSequence(basePath, sequence).catch(() => {})
    await finalizeStepRunScope(basePath, step, stepRuntime, false, []).catch(() => {})
    return {
      success: false,
      stepId,
      runId,
      status: 'FAILED' as const,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function POST(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session

    const rateLimited = applyRateLimit(request, {
      bucket: 'run',
      limit: 30,
      windowMs: 5 * 60 * 1000,
    })
    if (rateLimited) return rateLimited

    const body = BodySchema.parse(await request.json())
    const basePath = getBasePath()
    const sequence = await readSequence(basePath)
    validateDAG(sequence)

    const targetSteps = resolveTargetSteps(sequence, body)
    const batchPolicy = await enforceBatchPolicy(basePath, targetSteps.length, body.confirmPolicy === true)
    if (!batchPolicy.allowed) {
      const policyHttp = policyStatusToHttp(batchPolicy)
      return jsonError(batchPolicy.reason ?? 'Policy denied', policyHttp.code, policyHttp.status)
    }

    if (targetSteps.length === 0) {
      if ('stepId' in body) {
        return jsonError(`Step '${body.stepId}' not found`, 'NOT_FOUND', 404)
      }
      return NextResponse.json({ success: true, executed: [] })
    }

    const runId = randomUUID()
    const startedAt = new Date().toISOString()
    await createRunScopeForRequest(basePath, sequence.name, runId, startedAt)

    const policyEngine = await PolicyEngine.load(basePath)
    if (body.confirmPolicy === true && policyEngine.getConfig().mode === 'SAFE') {
      await recordApprovedApprovalLifecycle({
        basePath,
        runId,
        actionType: 'run',
        targetRef: targetRefFromRunBody(body),
        requestedBy: session.email,
        resolvedBy: session.email,
        actor: 'api:run',
        notes: 'SAFE mode confirmation acknowledged before dispatch.',
        policyRef: 'SAFE',
      })
    }

    if ('stepId' in body) {
      const result = await executeStep(basePath, sequence, body.stepId, runId, body.confirmPolicy === true)
      await finalizeRunScope(basePath, runId, result.success, `step:${body.stepId}`)
      await auditLog('run.step', body.stepId, { runId }, result.success ? 'ok' : 'failed')
      if (!result.success && 'confirmationRequired' in result && result.confirmationRequired) {
        return jsonError(result.error ?? 'Policy confirmation required', 'POLICY_CONFIRMATION_REQUIRED', 409)
      }
      return NextResponse.json(result)
    }

    if ('groupId' in body) {
      const results = []
      for (const step of targetSteps) {
        results.push(await executeStep(basePath, sequence, step.id, runId, body.confirmPolicy === true))
      }
      const success = results.every(result => result.success)
      await finalizeRunScope(basePath, runId, success, `group:${body.groupId}`)
      await auditLog('run.group', body.groupId, { runId, count: results.length }, success ? 'ok' : 'failed')
      return NextResponse.json({ success, executed: results })
    }

    const results = []
    for (const step of targetSteps) {
      results.push(await executeStep(basePath, sequence, step.id, runId, body.confirmPolicy === true))
    }
    const success = results.every(result => result.success)
    await finalizeRunScope(basePath, runId, success, 'mode:runnable')
    await auditLog('run.runnable', '*', { runId, count: results.length }, success ? 'ok' : 'failed')
    return NextResponse.json({ success, executed: results })
  } catch (error) {
    return handleError(error)
  }
}

import { readdir } from 'fs/promises'
import { ThreadSurfaceStateConflictError } from '../errors'
import { assertSafePathSegment, resolveExistingPathWithinRoot } from '../security/safe-path'
import { readTextFileNoFollow } from '../security/safe-io'
import { appendTraceEvent } from '../traces/writer'
import { agentRegistrationEvidence } from '../agents/execution'
import { ROOT_THREAD_SURFACE_ID } from '../thread-surfaces/constants'
import { completeRun, createReplacementRun, createRootThreadSurfaceRun } from '../thread-surfaces/mutations'
import { provisionAllChildSequences } from '../thread-surfaces/provision-child-sequence'
import {
  readThreadSurfaceState, withThreadSurfaceStateRevision, writeThreadSurfaceState, type ThreadSurfaceState,
} from '../thread-surfaces/repository'
import { beginStepRunIfSurfaceExists, finalizeStepRunWithRuntimeEvents, type StepRunScope } from '../thread-surfaces/step-run-runtime'
import { lookupRunRecordPath, lookupRunsRoot } from './paths'
import {
  LegacyRunRecordSchema,
  WorkflowRunSchema,
  projectLegacyRunRecord,
} from './schema'
import type {
  AttemptProjection,
  RunProjection,
  RuntimeProjectionPort,
  RuntimeRepositories,
  RuntimeRunQuery,
} from './service-types'

type DiscoveredRun =
  | { source: 'v2'; schemaVersion: 2; run: RunProjection['run'] }
  | { source: 'legacy'; schemaVersion: 1; run: ReturnType<typeof projectLegacyRunRecord> }

async function discoverRunRecord(path: string): Promise<DiscoveredRun | null> {
  let value: unknown
  try {
    value = JSON.parse(await readTextFileNoFollow(path))
  } catch {
    return null
  }
  const current = WorkflowRunSchema.safeParse(value)
  if (current.success) {
    return { source: 'v2', schemaVersion: 2, run: current.data }
  }
  const legacy = LegacyRunRecordSchema.safeParse(value)
  if (legacy.success) {
    return {
      source: 'legacy',
      schemaVersion: 1,
      run: projectLegacyRunRecord(legacy.data),
    }
  }
  return null
}

function matchesRunQuery(projection: RunProjection, query: RuntimeRunQuery): boolean {
  if (query.sequenceId && projection.run.sequence_id !== query.sequenceId) return false
  if (query.status && projection.run.status !== query.status) return false
  return true
}

async function projectDiscoveredRun(
  repositories: RuntimeRepositories,
  discovered: DiscoveredRun,
): Promise<RunProjection> {
  if (discovered.source === 'legacy') {
    return {
      source: discovered.source,
      schemaVersion: discovered.schemaVersion,
      run: discovered.run.workflowRun,
      attempts: [discovered.run.stepAttempt],
    }
  }
  return {
    source: discovered.source,
    schemaVersion: discovered.schemaVersion,
    run: discovered.run,
    attempts: await repositories.attempts.listForRun(discovered.run.id),
  }
}

export async function listRuntimeRunProjections(
  basePath: string,
  repositories: RuntimeRepositories,
  query: RuntimeRunQuery = {},
): Promise<RunProjection[]> {
  const root = await lookupRunsRoot(basePath)
  if (!root) return []
  const projections: RunProjection[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    assertSafePathSegment(entry.name, 'run id')
    const path = await resolveExistingPathWithinRoot(root, entry.name, 'run.json').catch(() => null)
    if (!path) continue
    const discovered = await discoverRunRecord(path)
    if (!discovered) continue
    const projection = await projectDiscoveredRun(repositories, discovered)
    if (projection.run.id !== entry.name || !matchesRunQuery(projection, query)) continue
    projections.push(projection)
  }
  return projections.sort((left, right) => left.run.id.localeCompare(right.run.id))
}

export async function inspectRuntimeRunProjection(
  basePath: string,
  repositories: RuntimeRepositories,
  runId: string,
): Promise<RunProjection | null> {
  assertSafePathSegment(runId, 'run id')
  const path = await lookupRunRecordPath(basePath, runId)
  if (!path) return null
  const discovered = await discoverRunRecord(path)
  if (!discovered) return null
  const projection = await projectDiscoveredRun(repositories, discovered)
  return projection.run.id === runId ? projection : null
}

export async function inspectRuntimeAttemptProjection(
  basePath: string,
  repositories: RuntimeRepositories,
  attemptId: string,
): Promise<AttemptProjection | null> {
  const attempt = attemptId.includes(':')
    ? null
    : await repositories.attempts.get(attemptId)
  if (attempt) {
    return {
      source: 'v2',
      schemaVersion: 2,
      attempt,
      process: attempt.process_id ? await repositories.processes.get(attempt.process_id) : null,
    }
  }
  const legacy = await listRuntimeRunProjections(basePath, repositories)
  for (const projection of legacy) {
    if (projection.source !== 'legacy') continue
    const projectedAttempt = projection.attempts.find(item => item.id === attemptId)
    if (projectedAttempt) {
      return {
        source: 'legacy',
        schemaVersion: 1,
        attempt: projectedAttempt,
        process: null,
      }
    }
  }
  return null
}

async function mutateProjection<T>(
  basePath: string,
  build: (current: ThreadSurfaceState) => { state: ThreadSurfaceState; result: T } | null,
): Promise<T | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await readThreadSurfaceState(basePath)
    const mutation = build(current)
    if (!mutation) return null
    try {
      await writeThreadSurfaceState(basePath, withThreadSurfaceStateRevision(current, mutation.state))
      return mutation.result
    } catch (error) {
      if (!(error instanceof ThreadSurfaceStateConflictError) || attempt === 2) throw error
    }
  }
  return null
}

type FinalizeAttemptInput = Parameters<RuntimeProjectionPort['finalizeAttempt']>[0]

function projectedStepRunScope(
  projected: ThreadSurfaceState['runs'][number] | undefined,
  executionIndex: number,
): StepRunScope | null {
  if (!projected) return null
  return {
    runId: projected.id,
    startedAt: projected.startedAt,
    executionIndex: projected.executionIndex ?? executionIndex,
    threadSurfaceId: projected.threadSurfaceId,
  }
}

function nextProjectionIds(attemptId: string, hasStepRun: boolean) {
  let childRun = 0
  let event = 0
  let merge = 0
  return {
    nextRunId: () => {
      childRun++
      return !hasStepRun && childRun === 1 ? attemptId : `${attemptId}-child-${childRun}`
    },
    nextEventId: () => `${attemptId}-event-${++event}`,
    nextMergeId: () => `${attemptId}-merge-${++merge}`,
  }
}

function bindAttemptProjection(state: ThreadSurfaceState, runId: string, attemptId: string): ThreadSurfaceState {
  return {
    ...state,
    runs: state.runs.map(item => item.id === attemptId
      ? { ...item, workflowRunId: runId, attemptId }
      : item),
    runEvents: state.runEvents.map(item => item.runId === attemptId
      ? { ...item, workflowRunId: runId, attemptId }
      : item),
  }
}

function newChildSpawnEvents(current: ThreadSurfaceState, finalized: ThreadSurfaceState) {
  const existingIds = new Set(current.runEvents.map(event => event.id))
  return finalized.runEvents.filter(event => !existingIds.has(event.id)
    && (event.eventType === 'child-agent-spawned' || event.eventType === 'spawn-denied'))
}

function buildAttemptFinalization(current: ThreadSurfaceState, { run, attempt, step, runtimeEvents }: FinalizeAttemptInput) {
  const projected = current.runs.find(item => item.attemptId === attempt.id || item.id === attempt.id)
  if (projected?.endedAt != null) return null
  const stepRun = projectedStepRunScope(projected, attempt.execution_index)
  const finalized = finalizeStepRunWithRuntimeEvents(current, {
    step, stepRun, success: attempt.status === 'completed', endedAt: attempt.ended_at ?? run.ended_at ?? run.created_at,
    runtimeEvents,
    ...nextProjectionIds(attempt.id, stepRun !== null),
    agentRegistration: attempt.agent_registration,
  })
  return {
    state: bindAttemptProjection(finalized.state, run.id, attempt.id),
    result: {
      pending: finalized.pendingChildSequences,
      events: newChildSpawnEvents(current, finalized.state),
    },
  }
}

export function createRuntimeProjections(basePath: string): RuntimeProjectionPort {
  return {
    async beginRun({ run, sequence }) {
      await mutateProjection(basePath, current => {
        if (current.runs.some(item => item.workflowRunId === run.id || item.id === run.id)) return null
        const executionIndex = current.runs.length + 1
        const result = current.threadSurfaces.some(surface => surface.id === ROOT_THREAD_SURFACE_ID)
          ? createReplacementRun(current, { threadSurfaceId: ROOT_THREAD_SURFACE_ID, runId: run.id, startedAt: run.created_at, executionIndex })
          : createRootThreadSurfaceRun(current, {
              surfaceId: ROOT_THREAD_SURFACE_ID, surfaceLabel: sequence.name, createdAt: run.created_at,
              runId: run.id, startedAt: run.created_at, executionIndex,
            })
        return {
          state: {
            ...result.state,
            threadSurfaces: result.state.threadSurfaces.map(surface => surface.id === ROOT_THREAD_SURFACE_ID
              ? { ...surface, workflowRunId: run.id }
              : surface),
            runs: result.state.runs.map(item => item.id === run.id ? { ...item, workflowRunId: run.id } : item),
          },
          result: undefined,
        }
      })
    },

    async beginAttempt({ run, attempt, step }) {
      await mutateProjection(basePath, current => {
        if (current.runs.some(item => item.attemptId === attempt.id || item.id === attempt.id)) return null
        const result = beginStepRunIfSurfaceExists(current, step, {
          now: attempt.created_at, nextRunId: attempt.id, executionIndex: attempt.execution_index,
          agentRegistration: attempt.agent_registration,
        })
        if (!result.stepRun) return null
        return {
          state: {
            ...result.state,
            runs: result.state.runs.map(item => item.id === attempt.id
              ? { ...item, workflowRunId: run.id, attemptId: attempt.id }
              : item),
          },
          result: undefined,
        }
      })
    },

    async finalizeAttempt({ run, attempt, step, runtimeEvents }) {
      const mutation = await mutateProjection(basePath, current => buildAttemptFinalization(current, { run, attempt, step, runtimeEvents }))
      if (!mutation) return
      for (const event of mutation.events) {
        const registration = attempt.agent_registration
        await appendTraceEvent(basePath, run.id, {
          ts: event.createdAt, run_id: run.id, surface_id: attempt.surface_id,
          actor: 'threados-runtime', event_type: event.eventType === 'spawn-denied' ? 'spawn-denied' : 'spawn-child',
          payload_ref: event.id, policy_ref: run.policy_snapshot_hash, attempt_id: attempt.id,
          ...(registration ? { agent_registration: agentRegistrationEvidence(registration) } : {}),
        })
      }
      if (mutation.pending.length > 0) await provisionAllChildSequences(basePath, mutation.pending)
    },

    async finalizeRun({ run }) {
      await mutateProjection(basePath, current => {
        const projected = current.runs.find(item => item.workflowRunId === run.id || item.id === run.id)
        if (!projected || projected.endedAt != null) return null
        return {
          state: completeRun(current, {
            runId: projected.id, runStatus: run.status === 'successful' ? 'successful' : 'failed',
            endedAt: run.ended_at ?? run.created_at, runSummary: run.summary ?? undefined,
          }).state,
          result: undefined,
        }
      })
    },
  }
}

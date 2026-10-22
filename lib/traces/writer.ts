import { mkdir } from 'fs/promises'
import { TraceEventSchema, type TraceEvent } from '@/lib/contracts/schemas'
import {
  assertSafePathSegment,
  resolveExistingPathWithinRoot,
  resolvePathWithinRoot,
} from '@/lib/security/safe-path'
import { appendFileNoFollow } from '@/lib/security/safe-io'
import { readTextFileNoFollow } from '@/lib/security/safe-io'
import { WorkflowRunSchema, StepAttemptSchema, type WorkflowRun } from '@/lib/runtime/schema'
import { agentRegistrationEvidence } from '@/lib/agents/execution'

function isCanonicalRun(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && 'schema_version' in raw && raw.schema_version === 2
}

async function readCanonicalRun(basePath: string, runId: string): Promise<WorkflowRun | null> {
  let raw: unknown
  try {
    const path = await resolveExistingPathWithinRoot(basePath, '.threados', 'runs', runId, 'run.json')
    raw = JSON.parse(await readTextFileNoFollow(path))
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
  // Existing legacy traces remain readable. Canonical execution evidence always
  // comes from the persisted run/attempt, never the current registry or caller.
  if (!isCanonicalRun(raw)) return null
  const run = WorkflowRunSchema.parse(raw)
  if (run.id !== runId) throw new Error('Trace run identity does not match its persisted record')
  return run
}

async function readFrozenAttemptRegistration(
  basePath: string,
  runId: string,
  attemptId: string,
  surfaceId: string,
  registrations: NonNullable<WorkflowRun['agent_registrations']>,
) {
  assertSafePathSegment(attemptId, 'attempt id')
  const path = await resolveExistingPathWithinRoot(basePath, '.threados', 'runs', runId, 'attempts', attemptId, 'attempt.json')
  const attempt = StepAttemptSchema.parse(JSON.parse(await readTextFileNoFollow(path)))
  const registration = registrations[attempt.step_id]
  if (attempt.id !== attemptId || attempt.workflow_run_id !== runId || !registration
    || JSON.stringify(registration) !== JSON.stringify(attempt.agent_registration)) {
    throw new Error('Trace attempt does not match the frozen run registration')
  }
  if (surfaceId !== attempt.surface_id) throw new Error('Trace surface does not match its registered attempt')
  return registration
}

async function bindFrozenRegistration(basePath: string, runId: string, event: TraceEvent): Promise<TraceEvent> {
  const run = await readCanonicalRun(basePath, runId)
  if (!run?.agent_registrations) return event
  const registrations = Object.fromEntries(Object.entries(run.agent_registrations)
    .map(([stepId, registration]) => [stepId, agentRegistrationEvidence(registration)]))
  const { agent_registration: _callerRegistration, agent_registrations: _callerRegistrations, ...bound } = event
  if (event.attempt_id) {
    const registration = await readFrozenAttemptRegistration(basePath, runId, event.attempt_id, event.surface_id, run.agent_registrations)
    return { ...bound, agent_registration: agentRegistrationEvidence(registration) }
  }
  return { ...bound, agent_registrations: registrations }
}

export async function appendTraceEvent(
  basePath: string,
  runId: string,
  event: TraceEvent,
): Promise<void> {
  assertSafePathSegment(runId, 'run id')
  let validated = TraceEventSchema.parse(event)
  if (validated.run_id !== runId) {
    throw new Error('Trace event run_id must match the target run id')
  }
  validated = TraceEventSchema.parse(await bindFrozenRegistration(basePath, runId, validated))
  const threadosPath = await resolvePathWithinRoot(basePath, '.threados')
  await mkdir(threadosPath, { recursive: true })
  const threadosRoot = await resolveExistingPathWithinRoot(basePath, '.threados')
  const runsRoot = await resolvePathWithinRoot(threadosRoot, 'runs')
  await mkdir(runsRoot, { recursive: true })
  const verifiedRunsRoot = await resolveExistingPathWithinRoot(threadosRoot, 'runs')
  const dirPath = await resolvePathWithinRoot(verifiedRunsRoot, runId)
  await mkdir(dirPath, { recursive: true })
  const verifiedRunDir = await resolveExistingPathWithinRoot(verifiedRunsRoot, runId)
  const filePath = await resolvePathWithinRoot(verifiedRunDir, 'trace.ndjson')
  await appendFileNoFollow(filePath, JSON.stringify(validated) + '\n')
}

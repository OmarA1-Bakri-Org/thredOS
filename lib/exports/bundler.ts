import { readdir } from 'fs/promises'
import { relative, sep } from 'path'
import { readTraceEvents } from '@/lib/traces/reader'
import { readGateDecisions } from '@/lib/gates/repository'
import { readApprovals } from '@/lib/approvals/repository'
import { readThreadSurfaceState } from '@/lib/thread-surfaces/repository'
import type { StatusJson } from '@/lib/runner/artifacts'
import type { ExportBundle } from './schema'
import {
  assertSafePathSegment,
  resolveExistingPathWithinRoot,
  resolvePathWithinRoot,
} from '@/lib/security/safe-path'
import { readTextFileNoFollow } from '@/lib/security/safe-io'
import { AttemptRepository } from '@/lib/runtime/attempt-repository'
import {
  LegacyRunRecordSchema,
  WorkflowRunSchema,
  projectLegacyRunRecord,
  type StepAttempt,
  type WorkflowRun,
} from '@/lib/runtime/schema'
import { hashSha256Bytes } from '@/lib/workspaces/hash'
import { agentRegistrationEvidence } from '@/lib/agents/execution'
import type { AgentRegistrationEvidence } from '@/lib/contracts/schemas'

function identityReference(value: string): string {
  try { return assertSafePathSegment(value, 'identity reference') } catch { return hashSha256Bytes(value) }
}

function redactRegistrationEvidence(evidence: AgentRegistrationEvidence): AgentRegistrationEvidence {
  return {
    ...evidence,
    registration_id: identityReference(evidence.registration_id),
    builder_id: identityReference(evidence.builder_id),
    supersedes_agent_id: evidence.supersedes_agent_id == null ? null : identityReference(evidence.supersedes_agent_id),
  }
}

function redactRegistrationMap(registrations: Record<string, AgentRegistrationEvidence>): Record<string, AgentRegistrationEvidence> {
  return Object.fromEntries(Object.entries(registrations)
    .map(([stepId, registration]) => [identityReference(stepId), redactRegistrationEvidence(registration)]))
}

interface RunDiscovery {
  source: 'legacy' | 'v2'
  schemaVersion: 1 | 2
  attempts: StepAttempt[]
  workflowRun: WorkflowRun | null
}

async function discoverRun(basePath: string, runDir: string, runId: string): Promise<RunDiscovery> {
  const raw = await readOptionalContainedFile(runDir, 'run.json')
  if (raw == null) return { source: 'legacy', schemaVersion: 1, attempts: [], workflowRun: null }
  const value: unknown = JSON.parse(raw)
  const v2 = WorkflowRunSchema.safeParse(value)
  if (v2.success) {
    if (v2.data.id !== runId) throw new Error('run record identity does not match export path')
    return {
      source: 'v2',
      schemaVersion: 2,
      attempts: await new AttemptRepository(basePath).listForRun(runId),
      workflowRun: v2.data,
    }
  }
  const legacy = LegacyRunRecordSchema.parse(value)
  if (legacy.id !== runId) throw new Error('legacy run record identity does not match export path')
  return {
    source: 'legacy',
    schemaVersion: 1,
    attempts: [projectLegacyRunRecord(legacy).stepAttempt],
    workflowRun: null,
  }
}

async function readOptionalContainedFile(root: string, fileName: string): Promise<string | null> {
  try {
    const filePath = await resolveExistingPathWithinRoot(root, fileName)
    return await readTextFileNoFollow(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function collectArtifactManifests(runDir: string): Promise<string[]> {
  try {
    const entries = await readdir(runDir, { withFileTypes: true })
    const manifests = await Promise.all(entries.map(async entry => {
      const entryPath = await resolvePathWithinRoot(runDir, entry.name)
      if (entry.isDirectory()) {
        return await collectArtifactManifests(entryPath)
      }
      return [entryPath]
    }))
    return manifests.flat().sort((left, right) => left.localeCompare(right))
  } catch {
    return []
  }
}

async function collectStepStatuses(runDir: string): Promise<StatusJson[]> {
  const manifests = await collectArtifactManifests(runDir)
  const statusPaths = manifests.filter(path => path.endsWith('status.json'))
  const statuses = await Promise.all(statusPaths.map(async path => {
    try {
      return JSON.parse(await readTextFileNoFollow(path)) as StatusJson
    } catch {
      return null
    }
  }))
  return statuses.filter((status): status is StatusJson => status != null)
}

function summarizeTiming(statuses: StatusJson[]) {
  if (statuses.length === 0) return null

  const totalDurationMs = statuses.reduce((sum, status) => sum + status.duration, 0)
  const startTimes = statuses.map(status => Date.parse(status.startTime)).filter(Number.isFinite)
  const endTimes = statuses.map(status => Date.parse(status.endTime)).filter(Number.isFinite)

  return {
    stepCount: statuses.length,
    totalDurationMs,
    longestStepMs: Math.max(...statuses.map(status => status.duration)),
    failedSteps: statuses.filter(status => status.status !== 'SUCCESS').length,
    successfulSteps: statuses.filter(status => status.status === 'SUCCESS').length,
    startedAt: startTimes.length > 0 ? new Date(Math.min(...startTimes)).toISOString() : null,
    endedAt: endTimes.length > 0 ? new Date(Math.max(...endTimes)).toISOString() : null,
  }
}

export async function generateExportBundle(basePath: string, runId: string): Promise<ExportBundle> {
  assertSafePathSegment(runId, 'runId')

  let threadosRoot: string | null = null
  try {
    threadosRoot = await resolveExistingPathWithinRoot(basePath, '.threados')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  // Read sequence snapshot
  const sequenceSnapshot = threadosRoot
    ? await readOptionalContainedFile(threadosRoot, 'sequence.yaml') ?? ''
    : ''

  // Read policy snapshot
  const policySnapshot = threadosRoot
    ? await readOptionalContainedFile(threadosRoot, 'policy.yaml')
    : null

  // Read run artifacts
  const runDir = await resolvePathWithinRoot(basePath, '.threados/runs', runId)
  const runDiscovery = await discoverRun(basePath, runDir, runId)
  const traceEvents = await readTraceEvents(basePath, runId)
  const gateDecisions = await readGateDecisions(basePath, runId)
  const approvals = await readApprovals(basePath, runId)
  const surfaceState = await readThreadSurfaceState(basePath)
  const artifactManifestPaths = await collectArtifactManifests(runDir)
  const stepStatuses = await collectStepStatuses(runDir)

  return {
    bundle_version: '1.0',
    run_id: runId,
    run_source: runDiscovery.source,
    run_schema_version: runDiscovery.schemaVersion,
    workflow_run: runDiscovery.workflowRun == null ? null : {
      ...runDiscovery.workflowRun,
      ...(runDiscovery.workflowRun.agent_registrations ? {
        agent_registrations: redactRegistrationMap(Object.fromEntries(Object.entries(runDiscovery.workflowRun.agent_registrations)
          .map(([stepId, registration]) => [stepId, agentRegistrationEvidence(registration)]))),
      } : {}),
    },
    attempts: runDiscovery.attempts.map(attempt => ({
      ...attempt,
      agent_ref: attempt.agent_ref == null ? null : identityReference(attempt.agent_ref),
      ...(attempt.agent_registration ? { agent_registration: redactRegistrationEvidence(agentRegistrationEvidence(attempt.agent_registration)) } : {}),
    })),
    pack: { id: null, version: null },
    sequence_snapshot: sequenceSnapshot,
    policy_snapshot: policySnapshot,
    surfaces: surfaceState.threadSurfaces,
    trace_events: traceEvents.map(event => ({
      ...event,
      ...(event.attempt_id ? { attempt_id: identityReference(event.attempt_id) } : {}),
      ...(event.agent_registration ? { agent_registration: redactRegistrationEvidence(event.agent_registration) } : {}),
      ...(event.agent_registrations ? { agent_registrations: redactRegistrationMap(event.agent_registrations) } : {}),
    })),
    gate_decisions: gateDecisions,
    approvals,
    artifact_manifests: artifactManifestPaths.map(path => relative(basePath, path).split(sep).join('/')),
    timing_summary: summarizeTiming(stepStatuses),
    cost_summary: null,
    exported_at: new Date().toISOString(),
  }
}

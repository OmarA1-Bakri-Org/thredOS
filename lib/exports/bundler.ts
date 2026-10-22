import { readdir } from 'fs/promises'
import { basename, isAbsolute, relative, sep, win32 } from 'path'
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
import { ProcessRepository } from '@/lib/runtime/process-repository'
import {
  LegacyRunRecordSchema,
  WorkflowRunSchema,
  projectLegacyRunRecord,
  type ProcessRecord,
  type StepAttempt,
  type WorkflowRun,
} from '@/lib/runtime/schema'
import { SnapshotRepository } from '@/lib/workspaces/snapshot-repository'
import { WorkspaceRepository } from '@/lib/workspaces/repository'
import type {
  SnapshotManifest,
  SurfaceWorkspace,
  WorkspaceSnapshot,
} from '@/lib/workspaces/schema'
import { hashSha256Bytes } from '@/lib/workspaces/hash'
import { exportEvidenceReference, redactExportText } from './redaction'
import { normalizeThreadSurface } from '@/lib/thread-surfaces/types'
import { agentRegistrationEvidence } from '@/lib/agents/execution'
import type { AgentRegistrationEvidence } from '@/lib/contracts/schemas'

function redactRegistrationEvidence(evidence: AgentRegistrationEvidence): AgentRegistrationEvidence {
  return {
    ...evidence,
    registration_id: exportEvidenceReference(evidence.registration_id),
    builder_id: exportEvidenceReference(evidence.builder_id),
    supersedes_agent_id: evidence.supersedes_agent_id == null ? null : exportEvidenceReference(evidence.supersedes_agent_id),
  }
}

interface RunDiscovery {
  source: 'legacy' | 'v2'
  schemaVersion: 1 | 2
  workflowRun: WorkflowRun | null
  attempts: StepAttempt[]
}

async function discoverRun(basePath: string, runDir: string, runId: string): Promise<RunDiscovery> {
  const raw = await readOptionalContainedFile(runDir, 'run.json')
  if (raw == null) {
    const [attempts, workspaces] = await Promise.all([
      new AttemptRepository(basePath).listForRun(runId),
      new WorkspaceRepository(basePath).list(),
    ])
    if (attempts.length > 0 || workspaces.some(record => record.workflow_run_id === runId)) {
      throw new Error(`EXPORT_RUN_EVIDENCE_MISSING: run ${runId} has child records without run.json`)
    }
    return { source: 'legacy', schemaVersion: 1, workflowRun: null, attempts: [] }
  }
  const value: unknown = JSON.parse(raw)
  const v2 = WorkflowRunSchema.safeParse(value)
  if (v2.success) {
    if (v2.data.id !== runId) throw new Error('run record identity does not match export path')
    return {
      source: 'v2',
      schemaVersion: 2,
      workflowRun: v2.data,
      attempts: await new AttemptRepository(basePath).listForRun(runId),
    }
  }
  const legacy = LegacyRunRecordSchema.parse(value)
  if (legacy.id !== runId) throw new Error('legacy run record identity does not match export path')
  const projection = projectLegacyRunRecord(legacy)
  return {
    source: 'legacy',
    schemaVersion: 1,
    workflowRun: projection.workflowRun,
    attempts: [projection.stepAttempt],
  }
}

function redactProcess(
  record: ProcessRecord,
  privateRoots: readonly string[],
): ExportBundle['processes'][number] {
  const redactArgument = (value: string): string => {
    if (isAbsolute(value) || win32.isAbsolute(value)) return '[redacted]'
    const knownRootsRedacted = privateRoots.reduce(
      (current, root) => current.replaceAll(root, '[redacted]'),
      value,
    )
    return redactExportText(knownRootsRedacted
      .replace(/[A-Za-z]:[\\/][^\s'"`,;)]+/g, '[redacted]')
      .replace(/(^|[\s='"`(])\/(?:[^\s'"`,;)]+\/)*[^\s'"`,;)]+/g, '$1[redacted]'))
  }
  return {
    ...record,
    provider_handle: record.provider_handle == null ? null : redactExportText(record.provider_handle),
    command: redactExportText(win32.isAbsolute(record.command) ? win32.basename(record.command)
      : isAbsolute(record.command) ? basename(record.command) : record.command),
    redacted_args: record.redacted_args.map(redactArgument),
    environment_keys: record.environment_keys?.map(redactExportText),
    cwd: '[redacted]',
    signal: record.signal == null ? null : redactExportText(record.signal),
  }
}

function redactSnapshot(record: WorkspaceSnapshot): ExportBundle['snapshots'][number]['record'] {
  return {
    ...record,
    source_root: '[redacted]',
    content_root: record.content_root == null ? null : '[redacted]',
    blocked_symlink_paths: record.blocked_symlink_paths.map(hashSha256Bytes),
  }
}

function redactWorkspace(record: SurfaceWorkspace): ExportBundle['workspaces'][number] {
  return { ...record, root_path: '[redacted]' }
}

function redactSnapshotManifest(
  manifest: SnapshotManifest,
): ExportBundle['snapshots'][number]['manifest'] {
  return {
    schema_version: 1,
    snapshot_id: manifest.snapshot_id,
    root_manifest_hash: manifest.root_manifest_hash,
    entries: manifest.entries.map(entry => ({
      path_sha256: hashSha256Bytes(entry.path),
      kind: entry.kind,
      sha256: entry.sha256,
      size_bytes: entry.size_bytes,
      mode: entry.mode,
      symlink_target_sha256: entry.symlink_target == null
        ? null
        : hashSha256Bytes(entry.symlink_target),
    })),
  }
}

async function collectM1Evidence(
  basePath: string,
  runId: string,
  discovery: RunDiscovery,
): Promise<Pick<ExportBundle, 'processes' | 'snapshots' | 'workspaces'>> {
  if (discovery.source !== 'v2') {
    return { processes: [], snapshots: [], workspaces: [] }
  }

  const attemptIds = new Set(discovery.attempts.map(attempt => attempt.id))
  const workspaceRecords = (await new WorkspaceRepository(basePath).list())
    .filter(record => record.workflow_run_id === runId && attemptIds.has(record.attempt_id))

  const snapshotIds = new Set([
    discovery.workflowRun?.baseline_snapshot_id ?? null,
    ...discovery.attempts.map(attempt => attempt.baseline_snapshot_id),
    ...workspaceRecords.map(workspace => workspace.snapshot_id),
  ].filter((value): value is string => value != null))
  const snapshotRepository = new SnapshotRepository(basePath)
  const snapshotEvidence = await Promise.all([...snapshotIds].sort().map(async snapshotId => {
    const [record, manifest] = await Promise.all([
      snapshotRepository.get(snapshotId),
      snapshotRepository.getManifest(snapshotId),
    ])
    if (!record || !manifest) {
      throw new Error(`EXPORT_SNAPSHOT_EVIDENCE_MISSING: snapshot ${snapshotId} requires a record and manifest`)
    }
    return { record, manifest }
  }))
  const privateRoots = [
    basePath,
    ...workspaceRecords.map(workspace => workspace.root_path),
    ...snapshotEvidence.flatMap(item => [item.record.source_root, item.record.content_root]),
  ].filter((value): value is string => value != null)
  const processes = (await new ProcessRepository(basePath).list())
    .filter(record => record.workflow_run_id === runId && attemptIds.has(record.attempt_id))
    .map(record => redactProcess(record, privateRoots))
  for (const attempt of discovery.attempts) {
    if (attempt.process_id && !processes.some(record => record.id === attempt.process_id)) {
      throw new Error(`EXPORT_PROCESS_EVIDENCE_MISSING: process ${attempt.process_id} was not found`)
    }
    if (attempt.workspace_id && !workspaceRecords.some(record => record.id === attempt.workspace_id)) {
      throw new Error(`EXPORT_WORKSPACE_EVIDENCE_MISSING: workspace ${attempt.workspace_id} was not found`)
    }
  }
  const snapshots = snapshotEvidence.map(item => ({
    record: redactSnapshot(item.record),
    manifest: redactSnapshotManifest(item.manifest),
  }))
  const workspaces = workspaceRecords.map(redactWorkspace)

  return { processes, snapshots, workspaces }
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
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
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
  const sequenceSnapshotSource = threadosRoot
    ? await readOptionalContainedFile(threadosRoot, 'sequence.yaml') ?? ''
    : ''

  // Read policy snapshot
  const policySnapshotSource = threadosRoot
    ? await readOptionalContainedFile(threadosRoot, 'policy.yaml')
    : null
  const sequenceSnapshot = hashSha256Bytes(sequenceSnapshotSource)
  const policySnapshot = policySnapshotSource == null ? null : hashSha256Bytes(policySnapshotSource)

  // Read run artifacts
  const runDir = await resolvePathWithinRoot(basePath, '.threados/runs', runId)
  const runDiscovery = await discoverRun(basePath, runDir, runId)
  const m1Evidence = await collectM1Evidence(basePath, runId, runDiscovery)
  const traceEvents = await readTraceEvents(basePath, runId)
  const gateDecisions = await readGateDecisions(basePath, runId)
  const approvals = await readApprovals(basePath, runId)
  const surfaceState = await readThreadSurfaceState(basePath)
  const attemptIds = new Set(runDiscovery.attempts.map(attempt => attempt.id))
  const surfaceIds = new Set([
    ...runDiscovery.attempts.map(attempt => attempt.surface_id),
    ...surfaceState.runs.filter(scope =>
      scope.workflowRunId === runId || attemptIds.has(scope.attemptId ?? '') || scope.id === runId,
    ).map(scope => scope.threadSurfaceId),
    ...traceEvents.filter(event =>
      event.event_type === 'surface-revealed'
      && surfaceState.threadSurfaces.some(surface =>
        surface.id === event.surface_id && surface.revealState === 'revealed',
      ),
    ).map(event => event.surface_id),
  ])
  const surfaces = surfaceState.threadSurfaces
    .filter(surface => surfaceIds.has(surface.id))
    .map(surface => {
      const normalized = normalizeThreadSurface(surface)
      return {
        id: redactExportText(surface.id),
        surfaceClass: normalized.surfaceClass,
        visibility: normalized.visibility,
        isolationLabel: normalized.isolationLabel,
        revealState: normalized.revealState,
      }
    })
  const safeTraces = traceEvents.map(event => ({
    ...event,
    actor: redactExportText(event.actor),
    surface_id: exportEvidenceReference(event.surface_id),
    payload_ref: event.payload_ref == null ? null : exportEvidenceReference(event.payload_ref),
    policy_ref: event.policy_ref == null ? null : exportEvidenceReference(event.policy_ref),
    ...(event.attempt_id ? { attempt_id: exportEvidenceReference(event.attempt_id) } : {}),
    ...(event.agent_registration ? { agent_registration: redactRegistrationEvidence(event.agent_registration) } : {}),
    ...(event.agent_registrations ? {
      agent_registrations: Object.fromEntries(Object.entries(event.agent_registrations)
        .map(([stepId, registration]) => [exportEvidenceReference(stepId), redactRegistrationEvidence(registration)])),
    } : {}),
  }))
  const safeGates = gateDecisions.map(decision => ({
    ...decision,
    subject_ref: exportEvidenceReference(decision.subject_ref),
    reason_codes: decision.reason_codes.map(redactExportText),
    evidence_refs: decision.evidence_refs.map(exportEvidenceReference),
  }))
  const safeApprovals = approvals.map(approval => ({
    ...approval,
    target_ref: redactExportText(approval.target_ref),
    requested_by: redactExportText(approval.requested_by),
    approved_by: approval.approved_by == null ? null : redactExportText(approval.approved_by),
    notes: approval.notes == null ? null : hashSha256Bytes(approval.notes),
    payload_ref: approval.payload_ref == null ? null : exportEvidenceReference(approval.payload_ref),
    policy_ref: approval.policy_ref == null ? null : exportEvidenceReference(approval.policy_ref),
    consumed_by: approval.consumed_by == null ? null : redactExportText(approval.consumed_by),
  }))
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
        agent_registrations: Object.fromEntries(Object.entries(runDiscovery.workflowRun.agent_registrations)
          .map(([stepId, registration]) => [exportEvidenceReference(stepId), redactRegistrationEvidence(agentRegistrationEvidence(registration))])),
      } : {}),
      created_by: redactExportText(runDiscovery.workflowRun.created_by),
      summary: runDiscovery.workflowRun.summary == null
        ? null : redactExportText(runDiscovery.workflowRun.summary),
      error_message: runDiscovery.workflowRun.error_message == null
        ? null : redactExportText(runDiscovery.workflowRun.error_message),
    },
    attempts: runDiscovery.attempts.map(attempt => ({
      ...attempt,
      ...(attempt.agent_registration ? {
        agent_registration: redactRegistrationEvidence(agentRegistrationEvidence(attempt.agent_registration)),
      } : {}),
      agent_ref: attempt.agent_ref == null ? null : exportEvidenceReference(attempt.agent_ref),
      error_message: attempt.error_message == null
        ? null : redactExportText(attempt.error_message),
      input_manifest_ref: attempt.input_manifest_ref == null
        ? null : exportEvidenceReference(attempt.input_manifest_ref),
      output_manifest_ref: attempt.output_manifest_ref == null
        ? null : exportEvidenceReference(attempt.output_manifest_ref),
      artifact_manifest_ref: attempt.artifact_manifest_ref == null
        ? null : exportEvidenceReference(attempt.artifact_manifest_ref),
    })),
    processes: m1Evidence.processes,
    snapshots: m1Evidence.snapshots,
    workspaces: m1Evidence.workspaces,
    pack: { id: null, version: null },
    sequence_snapshot: sequenceSnapshot,
    policy_snapshot: policySnapshot,
    surfaces,
    trace_events: safeTraces,
    gate_decisions: safeGates,
    approvals: safeApprovals,
    artifact_manifests: artifactManifestPaths.map(path =>
      hashSha256Bytes(relative(basePath, path).split(sep).join('/'))),
    timing_summary: summarizeTiming(stepStatuses),
    cost_summary: null,
    exported_at: new Date().toISOString(),
  }
}

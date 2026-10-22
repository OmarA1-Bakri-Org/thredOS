import { mkdir, realpath } from 'fs/promises'
import { withExclusiveFileLock, writeFileAtomic } from '../fs/atomic'
import { readLocalWorkspace } from '../local-first/workspace'
import { RuntimeCommandContextSchema, type RuntimeCommandContext } from '../runtime/command-schema'
import { AttemptRepository } from '../runtime/attempt-repository'
import { RunRepository, RuntimeRepositoryError } from '../runtime/run-repository'
import type { StepAttempt } from '../runtime/schema'
import { assertSafePathSegment, resolveExistingPathWithinRoot, resolvePathWithinRoot } from '../security/safe-path'
import { readTextFileNoFollow } from '../security/safe-io'
import { readThreadSurfaceState } from '../thread-surfaces/repository'
import { readGateDecisions } from '../gates/repository'
import { ProcessRepository } from '../runtime/process-repository'
import { z } from 'zod'
import { appendTraceEvent } from '../traces/writer'
import { readTraceEvents } from '../traces/reader'
import { resolveRuntimeDataRoot, resolveWorkspaceRuntimePaths } from '../workspaces/paths'
import { SnapshotRepository } from '../workspaces/snapshot-repository'
import { readCandidateValidation } from './validation'
import { ChangeSetContentStore } from './content-store'
import { buildChangeSetReview, compareChangeSets, summarizeChangeSet,
  type ChangeSetComparison, type ChangeSetReview, type ChangeSetSummary } from './diff'
import { ChangeSetRepository } from './repository'
import { ChangeSetDecisionReceiptSchema, type ChangeSet } from './schema'

type DecisionAction = 'select' | 'reject'
const terminalAttemptStatuses = new Set(['completed', 'needs_review', 'failed', 'cancelled', 'timed_out', 'interrupted'])
const ArtifactManifestEvidenceSchema = z.object({
  stepId: z.string(), runId: z.string(), surfaceId: z.string(), success: z.boolean(),
  outputContractRef: z.string().nullable(), completionContract: z.string().nullable(),
}).passthrough()

export async function assertChangeSetVisible(basePath: string, surfaceId: string): Promise<void> {
  safeId(surfaceId, 'surface id')
  const state = await readThreadSurfaceState(basePath)
  const surface = state.threadSurfaces.find(candidate => candidate.id === surfaceId)
  if (!surface) {
    throw new RuntimeRepositoryError('CHANGE_SET_NOT_REVEALED',
      'Change Set surface visibility cannot be verified')
  }
  if (surface.surfaceClass === 'sealed' && surface.revealState !== 'revealed') {
    throw new RuntimeRepositoryError('CHANGE_SET_NOT_REVEALED',
      'Change Set contents are sealed until the surface is revealed')
  }
}

function safeId(value: string, label: string): string {
  try { return assertSafePathSegment(value, label) } catch {
    throw new RuntimeRepositoryError('VALIDATION_ERROR', `Invalid ${label}`)
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function assertAttemptBinding(attempt: StepAttempt, record: ChangeSet): void {
  if (attempt.change_set_id !== record.id || attempt.workflow_run_id !== record.workflow_run_id
    || attempt.id !== record.attempt_id || attempt.step_id !== record.step_id
    || attempt.surface_id !== record.surface_id || attempt.agent_ref !== record.agent_ref
    || attempt.workspace_id !== record.workspace_id || attempt.baseline_snapshot_id !== record.baseline_snapshot_id) {
    throw new RuntimeRepositoryError('CHANGE_SET_IDENTITY_MISMATCH', 'Change Set lineage does not match its attempt')
  }
}

export class ChangeSetOperations {
  constructor(private readonly basePath: string, private readonly tracePorts: {
    appendTrace?: typeof appendTraceEvent
    readTraces?: typeof readTraceEvents
  } = {}) {}

  private async ensureDecisionTrace(record: ChangeSet): Promise<void> {
    const decision = record.decision
    if (!decision) throw new RuntimeRepositoryError('CHANGE_SET_INVALID_TRANSITION', 'Decision evidence is missing')
    const receiptName = `${record.id}-r${record.revision}.json`
    const receiptRef = `.threados/changesets/decisions/${receiptName}`
    const receipt = ChangeSetDecisionReceiptSchema.parse({
      schema_version: 1, change_set_id: record.id, revision: record.revision,
      change_set_root_hash: record.change_set_root_hash, decision,
    })
    const event = {
      ts: decision.decided_at, run_id: record.workflow_run_id, surface_id: record.surface_id,
      actor: decision.actor,
      event_type: decision.action === 'select' ? 'change-set-selected' as const : 'change-set-rejected' as const,
      payload_ref: receiptRef,
      policy_ref: null,
    }
    const matches = (candidate: Awaited<ReturnType<typeof readTraceEvents>>[number]): boolean => (
      candidate.ts === event.ts && candidate.run_id === event.run_id
      && candidate.surface_id === event.surface_id && candidate.actor === event.actor
      && candidate.event_type === event.event_type && candidate.payload_ref === event.payload_ref
    )
    try {
      const lockPath = await resolvePathWithinRoot(this.basePath, '.threados', 'changesets', `${record.id}.decision-trace.lock`)
      await withExclusiveFileLock(lockPath, async () => {
        const decisionsPath = await resolvePathWithinRoot(this.basePath, '.threados', 'changesets', 'decisions')
        await mkdir(decisionsPath, { recursive: true })
        await resolveExistingPathWithinRoot(this.basePath, '.threados', 'changesets', 'decisions')
        const receiptPath = await resolvePathWithinRoot(this.basePath, '.threados', 'changesets', 'decisions', receiptName)
        try {
          const existing = ChangeSetDecisionReceiptSchema.parse(JSON.parse(await readTextFileNoFollow(receiptPath)))
          if (JSON.stringify(existing) !== JSON.stringify(receipt)) throw new Error('Decision receipt conflict')
        } catch (error) {
          if (!isMissing(error)) throw error
          await writeFileAtomic(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { allowedRoot: this.basePath })
        }
        const read = this.tracePorts.readTraces ?? readTraceEvents
        const append = this.tracePorts.appendTrace ?? appendTraceEvent
        if ((await read(this.basePath, record.workflow_run_id)).some(matches)) return
        await append(this.basePath, record.workflow_run_id, event)
        if (!(await read(this.basePath, record.workflow_run_id)).some(matches)) {
          throw new Error('Decision trace did not persist')
        }
      }, { allowedRoot: this.basePath, timeoutMs: 30_000 })
    } catch {
      throw new RuntimeRepositoryError('CHANGE_SET_TRACE_PERSIST_FAILED',
        'Change Set decision committed but trace persistence failed')
    }
  }

  private async repository(runId: string, attemptId: string): Promise<ChangeSetRepository> {
    const local = await readLocalWorkspace(this.basePath)
    const canonicalRoot = await realpath(this.basePath)
    const runtimeDataRoot = await resolveRuntimeDataRoot({ canonicalRoot, override: local.runtimeDataRoot })
    const namespace = resolveWorkspaceRuntimePaths(runtimeDataRoot, local.id, canonicalRoot).workspaceNamespace
    return new ChangeSetRepository({ canonicalRoot, runtimeDataRoot, namespace, runId, attemptId })
  }

  private async record(runId: string, attemptId: string, expectedId?: string): Promise<{
    attempt: StepAttempt
    record: ChangeSet
    repository: ChangeSetRepository
  }> {
    safeId(runId, 'run id')
    safeId(attemptId, 'attempt id')
    if (expectedId) safeId(expectedId, 'change set id')
    const [run, attempt] = await Promise.all([
      new RunRepository(this.basePath).get(runId),
      new AttemptRepository(this.basePath).get(attemptId),
    ])
    if (!run || !attempt || attempt.workflow_run_id !== runId || !attempt.change_set_id
      || (expectedId && expectedId !== attempt.change_set_id)) {
      throw new RuntimeRepositoryError('CHANGE_SET_NOT_FOUND', 'Change Set was not found')
    }
    const repository = await this.repository(runId, attemptId)
    const record = await repository.get(attempt.change_set_id)
    if (!record) throw new RuntimeRepositoryError('CHANGE_SET_NOT_FOUND', 'Change Set was not found')
    assertAttemptBinding(attempt, record)
    return { attempt, record, repository }
  }

  async list(runId: string): Promise<ChangeSetSummary[]> {
    safeId(runId, 'run id')
    if (!await new RunRepository(this.basePath).get(runId)) {
      throw new RuntimeRepositoryError('RUN_NOT_FOUND', 'Run was not found')
    }
    const attempts = await new AttemptRepository(this.basePath).listForRun(runId)
    const summaries: ChangeSetSummary[] = []
    for (const attempt of attempts) {
      if (!attempt.change_set_id) continue
      const { record } = await this.record(runId, attempt.id)
      try { await assertChangeSetVisible(this.basePath, record.surface_id) }
      catch (error) {
        if (error instanceof RuntimeRepositoryError && error.code === 'CHANGE_SET_NOT_REVEALED') continue
        throw error
      }
      summaries.push(summarizeChangeSet(record))
    }
    return summaries.sort((left, right) => left.attempt_id.localeCompare(right.attempt_id))
  }

  async inspect(runId: string, attemptId: string, expectedId?: string): Promise<ChangeSetReview> {
    const { record } = await this.record(runId, attemptId, expectedId)
    await assertChangeSetVisible(this.basePath, record.surface_id)
    const snapshots = new SnapshotRepository(this.basePath)
    const [snapshot, manifest] = await Promise.all([
      snapshots.get(record.baseline_snapshot_id), snapshots.getManifest(record.baseline_snapshot_id),
    ])
    if (!snapshot || !snapshot.content_root || !manifest || snapshot.root_manifest_hash !== record.baseline_manifest_hash) {
      throw new RuntimeRepositoryError('CHANGE_SET_BASELINE_MISMATCH', 'Change Set baseline is unavailable or changed')
    }
    const local = await readLocalWorkspace(this.basePath)
    const canonicalRoot = await realpath(this.basePath)
    const runtimeDataRoot = await resolveRuntimeDataRoot({ canonicalRoot, override: local.runtimeDataRoot })
    const namespace = resolveWorkspaceRuntimePaths(runtimeDataRoot, local.id, canonicalRoot).workspaceNamespace
    return buildChangeSetReview({ record, baselineManifest: manifest,
      baselineContentRoot: snapshot.content_root,
      contentStore: new ChangeSetContentStore(runtimeDataRoot, namespace, runId, attemptId),
    })
  }

  async inspectById(id: string): Promise<ChangeSetReview> {
    const identity = await ChangeSetRepository.identity(this.basePath, safeId(id, 'change set id'))
    if (!identity) throw new RuntimeRepositoryError('CHANGE_SET_NOT_FOUND', 'Change Set was not found')
    return this.inspect(identity.runId, identity.attemptId, id)
  }

  async decideById(input: {
    action: DecisionAction
    changeSetId: string
    expectedRevision?: number
    reason?: string
  }, context: RuntimeCommandContext): Promise<ChangeSetSummary> {
    const id = safeId(input.changeSetId, 'change set id')
    const identity = await ChangeSetRepository.identity(this.basePath, id)
    if (!identity) throw new RuntimeRepositoryError('CHANGE_SET_NOT_FOUND', 'Change Set was not found')
    const current = (await this.record(identity.runId, identity.attemptId, id)).record
    const parsedContext = RuntimeCommandContextSchema.parse(context)
    const reason = input.action === 'reject' ? input.reason?.trim() : null
    const prior = current.decision
    const sameReplay = prior?.action === input.action && prior.actor === parsedContext.actor
      && prior.idempotency_key === parsedContext.idempotencyKey && prior.reason === reason
    const expectedRevision = input.expectedRevision
      ?? (sameReplay && prior ? prior.expected_revision : current.revision)
    return this.decide({ action: input.action, runId: identity.runId, attemptId: identity.attemptId,
      changeSetId: id, expectedRevision, reason: input.reason }, context)
  }

  async compare(runId: string, leftAttemptId: string, rightAttemptId: string): Promise<ChangeSetComparison> {
    const [left, right] = await Promise.all([
      this.record(runId, leftAttemptId), this.record(runId, rightAttemptId),
    ])
    await Promise.all([
      assertChangeSetVisible(this.basePath, left.record.surface_id),
      assertChangeSetVisible(this.basePath, right.record.surface_id),
    ])
    try { return compareChangeSets(left.record, right.record) } catch {
      throw new RuntimeRepositoryError('CHANGE_SET_BASELINE_MISMATCH', 'Candidates do not share a baseline')
    }
  }

  async finalizeEvidence(runId: string, attemptId: string): Promise<ChangeSet> {
    const { attempt, record, repository } = await this.record(runId, attemptId)
    const boundIds = new Set(attempt.gate_decision_refs)
    const decisions = (await readGateDecisions(this.basePath, runId))
      .filter(decision => boundIds.has(decision.id) && decision.subject_ref === record.step_id)
    const gate = (type: typeof decisions[number]['gate_type']) => decisions.filter(decision => decision.gate_type === type)
    const passed = (type: typeof decisions[number]['gate_type']) => {
      const matches = gate(type)
      return matches.length === 1 && matches[0]?.status === 'PASS'
    }
    const outputPass = passed('output_schema_pass') && passed('completion_contract_pass')
    const requiredPass = outputPass && passed('artifact_manifest_pass')
      && passed('change_set_captured') && passed('path_scope_respected')
      && record.path_scope_violations.length === 0
    const process = attempt.process_id ? await new ProcessRepository(this.basePath).get(attempt.process_id) : null
    const processPass = attempt.status === 'completed' && attempt.exit_code === 0
      && process !== null && process.id === attempt.process_id && process.workflow_run_id === runId
      && process.attempt_id === attemptId && process.workspace_id === record.workspace_id
      && process.process_purpose === 'agent' && process.status === 'exited' && process.exit_code === 0
    const expectedArtifactRef = `.threados/runs/${runId}/surfaces/${record.surface_id}/artifact.manifest.json`
    let artifactPass = false
    if (attempt.artifact_manifest_ref === expectedArtifactRef) {
      try {
        const path = await resolveExistingPathWithinRoot(this.basePath,
          '.threados', 'runs', runId, 'surfaces', record.surface_id, 'artifact.manifest.json')
        const manifest = ArtifactManifestEvidenceSchema.parse(JSON.parse(await readTextFileNoFollow(path)))
        artifactPass = manifest.runId === runId && manifest.stepId === record.step_id
          && manifest.surfaceId === record.surface_id && manifest.success === true
      } catch { /* Missing or invalid artifact evidence cannot pass. */ }
    }
    const executablePass = processPass && artifactPass && requiredPass
    const candidateValidation = await readCandidateValidation(this.basePath, runId, attemptId,
      record.workspace_id, record.validation.required_commands)
    const validationStatus = executablePass
      ? candidateValidation !== null ? 'passed' : 'pending'
      : 'failed'
    const evidenceRefs = [
      ...decisions.map(decision => decision.id),
      ...(candidateValidation ?? []),
      ...(artifactPass ? [expectedArtifactRef] : []),
    ].sort()
    const evidence = {
      validation: { status: validationStatus as ChangeSet['validation']['status'],
        evidence_refs: evidenceRefs, required_commands: record.validation.required_commands },
      outputContractState: (outputPass ? 'passed'
        : (gate('output_schema_pass').length > 0 || gate('completion_contract_pass').length > 0)
          ? 'failed' : 'pending') as ChangeSet['output_contract_state'],
      approvalState: 'not_required' as const,
    }
    if (record.revision > 0) {
      if (record.validation.status === evidence.validation.status
        && record.output_contract_state === evidence.outputContractState
        && record.approval_state === evidence.approvalState
        && JSON.stringify(record.validation.evidence_refs) === JSON.stringify(evidence.validation.evidence_refs)) {
        return record
      }
      throw new RuntimeRepositoryError('CHANGE_SET_EVIDENCE_CONFLICT',
        'Finalized Change Set evidence no longer matches persisted runtime evidence')
    }
    return repository.finalizeEvidence(record.id, record.revision, evidence)
  }

  async decide(input: {
    action: DecisionAction
    runId: string
    attemptId: string
    changeSetId?: string
    expectedRevision: number
    reason?: string
  }, rawContext: RuntimeCommandContext): Promise<ChangeSetSummary> {
    const context = RuntimeCommandContextSchema.parse(rawContext)
    if (context.interface !== 'api' && context.interface !== 'cli') {
      throw new RuntimeRepositoryError('POLICY_DENIED', 'Change Set decisions require an operator API or CLI action')
    }
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new RuntimeRepositoryError('VALIDATION_ERROR', 'expected_revision must be a nonnegative integer')
    }
    const reason = input.action === 'reject' ? input.reason?.trim() : null
    if (input.action === 'reject' && !reason) {
      throw new RuntimeRepositoryError('VALIDATION_ERROR', 'Rejection requires a reason')
    }
    const { attempt, record, repository } = await this.record(input.runId, input.attemptId, input.changeSetId)
    await assertChangeSetVisible(this.basePath, record.surface_id)
    if (!terminalAttemptStatuses.has(attempt.status)) {
      throw new RuntimeRepositoryError('CHANGE_SET_NOT_READY', 'Attempt has not reached a terminal state')
    }
    if (record.revision === 0) {
      throw new RuntimeRepositoryError('CHANGE_SET_NOT_READY',
        'Change Set evidence has not been finalized')
    }
    if (input.action === 'select' && (
      !['validated', 'selected'].includes(record.status)
      || record.validation.status !== 'passed'
      || record.output_contract_state !== 'passed'
      || !['approved', 'not_required'].includes(record.approval_state)
    )) {
      throw new RuntimeRepositoryError('CHANGE_SET_NOT_READY',
        'Change Set completion evidence does not permit selection')
    }
    const prior = record.decision
    if (prior?.idempotency_key === context.idempotencyKey
      && (prior.action !== input.action || prior.actor !== context.actor
        || prior.expected_revision !== input.expectedRevision || prior.reason !== reason)) {
      throw new RuntimeRepositoryError('IDEMPOTENCY_CONFLICT',
        'Idempotency key was already used for another Change Set decision')
    }
    if (record.revision !== input.expectedRevision) {
      if (prior?.action === input.action && prior.actor === context.actor
        && prior.idempotency_key === context.idempotencyKey
        && prior.expected_revision === input.expectedRevision
        && prior.reason === reason) {
        await this.ensureDecisionTrace(record)
        return summarizeChangeSet(record)
      }
      throw new RuntimeRepositoryError('CHANGE_SET_REVISION_CONFLICT', 'Change Set revision changed; inspect it again')
    }
    const decidedAt = new Date().toISOString()
    let updated: ChangeSet
    try {
      updated = await repository.update(record.id, input.expectedRevision, current => ({
        ...current,
        status: input.action === 'select' ? 'selected' : 'rejected',
        decision: {
          action: input.action, actor: context.actor, idempotency_key: context.idempotencyKey,
          expected_revision: input.expectedRevision, decided_at: decidedAt, reason: reason ?? null,
        },
      }))
    } catch (error) {
      if (error instanceof RuntimeRepositoryError && error.code === 'CHANGE_SET_REVISION_CONFLICT') {
        const latest = await repository.get(record.id)
        if (latest?.decision?.idempotency_key === context.idempotencyKey
          && (latest.decision.action !== input.action || latest.decision.actor !== context.actor
            || latest.decision.expected_revision !== input.expectedRevision
            || latest.decision.reason !== reason)) {
          throw new RuntimeRepositoryError('IDEMPOTENCY_CONFLICT',
            'Idempotency key was already used for another Change Set decision')
        }
        if (latest?.decision?.action === input.action && latest.decision.actor === context.actor
          && latest.decision.idempotency_key === context.idempotencyKey
          && latest.decision.expected_revision === input.expectedRevision
          && latest.decision.reason === reason) {
          await this.ensureDecisionTrace(latest)
          return summarizeChangeSet(latest)
        }
      }
      throw error
    }
    await this.ensureDecisionTrace(updated)
    return summarizeChangeSet(updated)
  }
}

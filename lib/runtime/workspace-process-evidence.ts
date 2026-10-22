import { lstat, readdir } from 'fs/promises'
import { resolve, sep } from 'path'
import { z } from 'zod'
import { isProcessAlive, isProcessGroupAlive } from '../runner/process-observation'
import { assertSafePathSegment, resolveExistingPathWithinRoot } from '../security/safe-path'
import { readTextFileNoFollow } from '../security/safe-io'
import type { SurfaceWorkspace } from '../workspaces/schema'
import { RuntimeServiceError } from './errors'
import { ProcessRepository } from './process-repository'
import { RunRepository } from './run-repository'
import { ProcessRecordSchema, StepAttemptSchema, type ProcessRecord, type StepAttempt } from './schema'

const BootstrapEvidenceSchema = z.object({
  workspace_id: z.string(), attempt_id: z.string(), index: z.number().int().nonnegative(),
  status: z.enum(['success', 'failed', 'policy_blocked', 'error']),
})

function unsafe(message = 'Workspace process termination is not established'): never {
  throw new RuntimeServiceError('WORKSPACE_NOT_CLEANABLE', message)
}

function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function optionalPath(basePath: string, segments: string[]): Promise<string | null> {
  try {
    const path = await resolveExistingPathWithinRoot(basePath, ...segments)
    if ((await lstat(path)).isSymbolicLink()) unsafe('Workspace runtime evidence contains a link')
    return path
  } catch (error) {
    if (missing(error)) return null
    throw error
  }
}

async function readAttempt(basePath: string, segments: string[]): Promise<StepAttempt | null> {
  const path = await optionalPath(basePath, [...segments, 'attempt.json'])
  return path === null ? null : StepAttemptSchema.parse(JSON.parse(await readTextFileNoFollow(path)))
}

async function addProcessEvidence(
  basePath: string,
  segments: string[],
  records: Map<string, ProcessRecord>,
  expectedId?: string,
): Promise<void> {
  const path = await optionalPath(basePath, segments)
  if (path === null) unsafe('Workspace process evidence disappeared during inspection')
  const record = ProcessRecordSchema.parse(JSON.parse(await readTextFileNoFollow(path)))
  assertSafePathSegment(record.id, 'process identifier')
  if (expectedId !== undefined && record.id !== expectedId) unsafe()
  if (records.has(record.id)) unsafe('Workspace process evidence has duplicate identities')
  records.set(record.id, record)
}

async function physicalProcesses(basePath: string, attemptSegments: string[]): Promise<Map<string, ProcessRecord>> {
  const records = new Map<string, ProcessRecord>()
  if (await optionalPath(basePath, [...attemptSegments, 'process.json'])) {
    await addProcessEvidence(basePath, [...attemptSegments, 'process.json'], records)
  }
  const directorySegments = [...attemptSegments, 'processes']
  const directory = await optionalPath(basePath, directorySegments)
  if (directory === null) return records
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.name.endsWith('.json')) continue
    if (!entry.isFile()) unsafe('Workspace process evidence is not a plain file')
    const id = assertSafePathSegment(entry.name.slice(0, -5), 'process identifier')
    await addProcessEvidence(basePath, [...directorySegments, entry.name], records, id)
  }
  return records
}

function assertAttemptBinding(workspace: SurfaceWorkspace, attempt: StepAttempt): void {
  if (attempt.id !== workspace.attempt_id || attempt.workflow_run_id !== workspace.workflow_run_id
    || attempt.workspace_id !== workspace.id || attempt.baseline_snapshot_id !== workspace.snapshot_id
    || attempt.surface_id !== workspace.surface_id) unsafe('Workspace attempt binding could not be verified')
  if (['pending', 'provisioning', 'running'].includes(attempt.status)) unsafe()
}

function assertProcessScope(workspace: SurfaceWorkspace, record: ProcessRecord): void {
  if (record.workflow_run_id !== workspace.workflow_run_id || record.attempt_id !== workspace.attempt_id
    || record.workspace_id !== workspace.id || record.cwd !== workspace.root_path) unsafe()
}

function assertExitedLocalProcess(record: ProcessRecord): void {
  if (record.status !== 'exited' || record.ended_at === null || record.provider !== 'local-process') unsafe()
}

function stoppedLocalPid(record: ProcessRecord): number {
  assertExitedLocalProcess(record)
  const pid = record.pid
  if (pid === null || pid <= 1) unsafe()
  if (record.provider_handle !== String(pid) && record.provider_handle !== `pid:${pid}`) unsafe()
  return pid
}

function assertProcessStopped(workspace: SurfaceWorkspace, record: ProcessRecord): void {
  assertProcessScope(workspace, record)
  const pid = stoppedLocalPid(record)
  // The existing Windows observer only proves leader absence, not descendant
  // termination. No persistent Windows tree-termination evidence exists here.
  if (process.platform === 'win32') unsafe('Workspace process-tree termination cannot be verified on Windows')
  if (isProcessAlive(pid) || isProcessGroupAlive(pid)) unsafe('Workspace process group is live or its termination cannot be verified')
}

function comparisonPath(path: string): string {
  const normalized = resolve(path)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function referencesWorkspace(claim: { workspace_id?: unknown; cwd?: unknown }, workspace: SurfaceWorkspace): boolean {
  if (claim.workspace_id === workspace.id) return true
  if (typeof claim.cwd !== 'string') return false
  const root = comparisonPath(workspace.root_path)
  const cwd = comparisonPath(claim.cwd)
  return cwd === root || cwd.startsWith(`${root}${sep}`)
}

function assertProcessAssociation(
  record: ProcessRecord, workspace: SurfaceWorkspace, inspected: Map<string, ProcessRecord>,
): void {
  if (!referencesWorkspace(record, workspace)) return
  const own = inspected.get(record.id)
  if (!own || record.workflow_run_id !== workspace.workflow_run_id || record.attempt_id !== workspace.attempt_id
    || JSON.stringify(record) !== JSON.stringify(own)) unsafe('Workspace has conflicting process associations')
}

async function directoryNames(basePath: string, segments: string[]): Promise<string[]> {
  const directory = await optionalPath(basePath, segments)
  if (directory === null) return []
  return (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name)
}

async function processClaimPaths(basePath: string, segments: string[]): Promise<string[][]> {
  const paths: string[][] = []
  if (await optionalPath(basePath, [...segments, 'process.json'])) paths.push([...segments, 'process.json'])
  const directory = await optionalPath(basePath, [...segments, 'processes'])
  if (directory === null) return paths
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.json')) paths.push([...segments, 'processes', entry.name])
  }
  return paths
}

async function assertPhysicalProcessClaim(
  basePath: string, segments: string[], workspace: SurfaceWorkspace, inspected: Map<string, ProcessRecord>,
): Promise<void> {
  const path = await optionalPath(basePath, segments)
  if (path === null) unsafe('Workspace process evidence changed during inspection')
  const text = await readTextFileNoFollow(path)
  let value: unknown
  try { value = JSON.parse(text) } catch {
    // Opaque unrelated JSON cannot establish an association. The owned attempt
    // was already parsed strictly, including every prior bootstrap process.
    return
  }
  const claim = z.object({ workspace_id: z.unknown().optional(), cwd: z.unknown().optional() }).safeParse(value)
  if (!claim.success || !referencesWorkspace(claim.data, workspace)) return
  // Check the physical slot before index quarantine can discard a wrong owner
  // or a copied identity whose JSON still explicitly claims this workspace.
  if (segments[2] !== workspace.workflow_run_id || segments[4] !== workspace.attempt_id) {
    unsafe('Workspace is claimed by another physical process record')
  }
  assertProcessAssociation(ProcessRecordSchema.parse(value), workspace, inspected)
}

async function assertPhysicalProcessAssociations(
  basePath: string, workspace: SurfaceWorkspace, inspected: Map<string, ProcessRecord>,
): Promise<void> {
  for (const run of await directoryNames(basePath, ['.threados', 'runs'])) {
    const attempts = ['.threados', 'runs', run, 'attempts']
    for (const attempt of await directoryNames(basePath, attempts)) {
      for (const segments of await processClaimPaths(basePath, [...attempts, attempt])) {
        await assertPhysicalProcessClaim(basePath, segments, workspace, inspected)
      }
    }
  }
}

async function assertIndexedProcessesStopped(
  basePath: string,
  workspace: SurfaceWorkspace,
  records: Map<string, ProcessRecord>,
): Promise<void> {
  const canonical = await new ProcessRepository(basePath).list()
  for (const record of canonical) assertProcessAssociation(record, workspace, records)
  const indexed = new Set(canonical.map(record => record.id))
  for (const record of records.values()) {
    if (!indexed.has(record.id)) unsafe('Workspace process evidence was quarantined')
    assertProcessStopped(workspace, record)
  }
}

async function assertBootstrapEvidence(
  basePath: string,
  segments: string[],
  workspace: SurfaceWorkspace,
  records: Map<string, ProcessRecord>,
): Promise<void> {
  const directory = await optionalPath(basePath, segments)
  if (directory === null) return
  for (const name of await readdir(directory)) {
    const match = /^bootstrap-(\d+)\.json$/.exec(name)
    if (!match) continue
    const artifact = await readBootstrapEvidence(basePath, [...segments, name], workspace, Number(match[1]))
    if (artifact.status === 'policy_blocked') continue
    const matching = [...records.values()].some(record =>
      record.process_purpose === 'bootstrap' && record.process_ordinal === artifact.index)
    if (!matching) unsafe('Workspace bootstrap process evidence is missing')
  }
}

async function readBootstrapEvidence(
  basePath: string, segments: string[], workspace: SurfaceWorkspace, index: number,
): Promise<z.infer<typeof BootstrapEvidenceSchema>> {
  const path = await optionalPath(basePath, segments)
  if (path === null) unsafe('Workspace bootstrap evidence disappeared during inspection')
  const artifact = BootstrapEvidenceSchema.parse(JSON.parse(await readTextFileNoFollow(path)))
  if (artifact.workspace_id !== workspace.id || artifact.attempt_id !== workspace.attempt_id
    || artifact.index !== index) unsafe('Workspace bootstrap evidence binding could not be verified')
  return artifact
}

function assertLaunchEvidence(attempt: StepAttempt, records: Map<string, ProcessRecord>): void {
  if (attempt.process_id !== null && !records.has(attempt.process_id)) unsafe('Workspace bound process evidence is missing')
  if (records.size !== 0) return
  if (attempt.started_at !== null || attempt.error_code?.startsWith('PROCESS_')) {
    unsafe('Workspace launch evidence is missing')
  }
}

async function inspectProcessTermination(basePath: string, workspace: SurfaceWorkspace): Promise<void> {
  assertSafePathSegment(workspace.workflow_run_id, 'run identifier')
  assertSafePathSegment(workspace.attempt_id, 'attempt identifier')
  const segments = ['.threados', 'runs', workspace.workflow_run_id, 'attempts', workspace.attempt_id]
  const run = await new RunRepository(basePath).get(workspace.workflow_run_id)
  const attempt = await readAttempt(basePath, segments)
  const records = await physicalProcesses(basePath, segments)
  await assertBootstrapEvidence(basePath, segments, workspace, records)
  await assertPhysicalProcessAssociations(basePath, workspace, records)
  if (attempt === null) {
    // A manager-only provision has never launched a process. A canonical run
    // or any physical process contradicts that allowance, even if unindexed.
    if (run !== null || records.size !== 0) unsafe('Workspace attempt evidence is missing')
    return
  }
  if (run === null || !run.attempt_ids.includes(attempt.id)) unsafe('Workspace run binding could not be verified')
  assertAttemptBinding(workspace, attempt)
  assertLaunchEvidence(attempt, records)
  await assertIndexedProcessesStopped(basePath, workspace, records)
}

/** Destructive cleanup must inspect physical evidence, including quarantined records. */
export async function assertWorkspaceProcessTermination(basePath: string, workspace: SurfaceWorkspace): Promise<void> {
  try {
    await inspectProcessTermination(basePath, workspace)
  } catch (error) {
    if (error instanceof RuntimeServiceError) throw error
    throw new RuntimeServiceError('WORKSPACE_NOT_CLEANABLE', 'Workspace process evidence could not be verified', error)
  }
}

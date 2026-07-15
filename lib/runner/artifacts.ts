import { mkdir } from 'fs/promises'
import { join } from 'path'
import { writeFileAtomic } from '../fs/atomic'
import {
  assertSafePathSegment,
  resolveExistingPathWithinRoot,
  resolvePathWithinRoot,
} from '../security/safe-path'
import { writeFileNoFollow } from '../security/safe-io'
import type { RunResult, RunStatus } from './wrapper'

const RUNS_PATH = '.threados/runs'
const EVENTS_LOG_FILE = 'events.jsonl'

export interface StatusJson {
  stepId: string
  runId: string
  startTime: string
  endTime: string
  duration: number
  exitCode: number | null
  status: RunStatus
}

export interface InputManifestJson {
  stepId: string
  runId: string
  surfaceId: string
  promptRef: string | null
  dependsOn: string[]
  inputContractRef: string | null
  createdAt: string
}

export interface ArtifactManifestJson {
  stepId: string
  runId: string
  surfaceId: string
  compiledPromptPath: string | null
  stdoutPath: string
  stderrPath: string
  statusPath: string
  outputContractRef: string | null
  completionContract: string | null
  createdAt: string
  success: boolean
}

export interface RunRecordJson {
  id: string
  sequence_id: string
  step_id: string
  surface_id: string
  attempt: number
  status: 'pending' | 'running' | 'successful' | 'failed' | 'cancelled'
  executor: string
  model: string
  policy_snapshot_hash: string
  compiled_prompt_hash: string
  input_manifest_ref: string | null
  artifact_manifest_ref: string | null
  started_at: string
  ended_at: string | null
  timing_summary: {
    duration_ms: number
  } | null
  cost_summary: {
    input_tokens?: number
    output_tokens?: number
    total_cost_usd?: number
  } | null
}

export interface SaveRunArtifactsOptions {
  surfaceId?: string
  compiledPrompt?: string
  inputManifest?: InputManifestJson
  outputContractRef?: string | null
  completionContract?: string | null
}

async function ensureRunsRoot(basePath: string): Promise<string> {
  const threadosPath = await resolvePathWithinRoot(basePath, '.threados')
  await mkdir(threadosPath, { recursive: true })
  const threadosRoot = await resolveExistingPathWithinRoot(basePath, '.threados')
  const runsRoot = await resolvePathWithinRoot(threadosRoot, 'runs')
  await mkdir(runsRoot, { recursive: true })
  return await resolveExistingPathWithinRoot(threadosRoot, 'runs')
}

async function ensureDirectoryWithin(root: string, ...segments: string[]): Promise<string> {
  const directoryPath = await resolvePathWithinRoot(root, ...segments)
  await mkdir(directoryPath, { recursive: true })
  return await resolveExistingPathWithinRoot(root, ...segments)
}

export async function createRunDirectory(
  basePath: string,
  runId: string,
  stepId: string,
): Promise<string> {
  assertSafePathSegment(runId, 'run id')
  assertSafePathSegment(stepId, 'step id')
  const runsRoot = await ensureRunsRoot(basePath)
  return await ensureDirectoryWithin(runsRoot, runId, stepId)
}

export function getRuntimeEventLogPath(
  basePath: string,
  runId: string,
  stepId: string,
): string {
  assertSafePathSegment(runId, 'run id')
  assertSafePathSegment(stepId, 'step id')
  return join(basePath, RUNS_PATH, runId, stepId, EVENTS_LOG_FILE)
}

export function getCanonicalRunDir(basePath: string, runId: string): string {
  assertSafePathSegment(runId, 'run id')
  return join(basePath, RUNS_PATH, runId)
}

export function getCanonicalSurfaceRunDir(basePath: string, runId: string, surfaceId: string): string {
  assertSafePathSegment(surfaceId, 'surface id')
  return join(getCanonicalRunDir(basePath, runId), 'surfaces', surfaceId)
}

async function ensureCanonicalSurfaceDirs(basePath: string, runId: string, surfaceId: string) {
  assertSafePathSegment(runId, 'run id')
  assertSafePathSegment(surfaceId, 'surface id')
  const runsRoot = await ensureRunsRoot(basePath)
  const surfaceDir = await ensureDirectoryWithin(runsRoot, runId, 'surfaces', surfaceId)
  await ensureDirectoryWithin(surfaceDir, 'outputs')
  await ensureDirectoryWithin(surfaceDir, 'logs')
  await ensureDirectoryWithin(surfaceDir, 'private')
  return surfaceDir
}

export async function writeStdout(artifactPath: string, content: string): Promise<void> {
  const filePath = await resolvePathWithinRoot(artifactPath, 'stdout.log')
  await writeFileNoFollow(filePath, content)
}

export async function writeStderr(artifactPath: string, content: string): Promise<void> {
  const filePath = await resolvePathWithinRoot(artifactPath, 'stderr.log')
  await writeFileNoFollow(filePath, content)
}

export async function writeStatus(artifactPath: string, status: StatusJson): Promise<void> {
  const filePath = await resolvePathWithinRoot(artifactPath, 'status.json')
  const content = JSON.stringify(status, null, 2)
  await writeFileAtomic(filePath, content)
}

export async function writeRunRecord(basePath: string, record: RunRecordJson): Promise<void> {
  assertSafePathSegment(record.id, 'run id')
  const runsRoot = await ensureRunsRoot(basePath)
  const runDir = await ensureDirectoryWithin(runsRoot, record.id)
  const filePath = await resolvePathWithinRoot(runDir, 'run.json')
  await writeFileAtomic(filePath, JSON.stringify(record, null, 2))
}

export async function writeCompiledPrompt(
  basePath: string,
  runId: string,
  surfaceId: string,
  compiledPrompt: string,
): Promise<string> {
  const surfaceDir = await ensureCanonicalSurfaceDirs(basePath, runId, surfaceId)
  const filePath = await resolvePathWithinRoot(surfaceDir, 'compiled-prompt.md')
  await writeFileAtomic(filePath, compiledPrompt)
  return filePath
}

export async function writeInputManifest(
  basePath: string,
  runId: string,
  surfaceId: string,
  manifest: InputManifestJson,
): Promise<string> {
  const surfaceDir = await ensureCanonicalSurfaceDirs(basePath, runId, surfaceId)
  const filePath = await resolvePathWithinRoot(surfaceDir, 'input.manifest.json')
  await writeFileAtomic(filePath, JSON.stringify(manifest, null, 2))
  return filePath
}

export async function writeArtifactManifest(
  basePath: string,
  runId: string,
  surfaceId: string,
  manifest: ArtifactManifestJson,
): Promise<string> {
  const surfaceDir = await ensureCanonicalSurfaceDirs(basePath, runId, surfaceId)
  const filePath = await resolvePathWithinRoot(surfaceDir, 'artifact.manifest.json')
  await writeFileAtomic(filePath, JSON.stringify(manifest, null, 2))
  return filePath
}

export async function saveRunArtifacts(
  basePath: string,
  result: RunResult,
  options: SaveRunArtifactsOptions = {},
): Promise<string> {
  const artifactPath = await createRunDirectory(basePath, result.runId, result.stepId)

  await writeStdout(artifactPath, result.stdout)
  await writeStderr(artifactPath, result.stderr)

  const status: StatusJson = {
    stepId: result.stepId,
    runId: result.runId,
    startTime: result.startTime.toISOString(),
    endTime: result.endTime.toISOString(),
    duration: result.duration,
    exitCode: result.exitCode,
    status: result.status,
  }
  await writeStatus(artifactPath, status)

  if (options.surfaceId) {
    const surfaceDir = await ensureCanonicalSurfaceDirs(basePath, result.runId, options.surfaceId)
    const logsDir = await resolveExistingPathWithinRoot(surfaceDir, 'logs')
    const stdoutPath = await resolvePathWithinRoot(logsDir, 'stdout.log')
    const stderrPath = await resolvePathWithinRoot(logsDir, 'stderr.log')
    const statusPath = await resolvePathWithinRoot(logsDir, 'status.json')
    await writeFileNoFollow(stdoutPath, result.stdout)
    await writeFileNoFollow(stderrPath, result.stderr)
    await writeFileAtomic(statusPath, JSON.stringify(status, null, 2))

    if (options.compiledPrompt) {
      await writeCompiledPrompt(basePath, result.runId, options.surfaceId, options.compiledPrompt)
    }

    if (options.inputManifest) {
      await writeInputManifest(basePath, result.runId, options.surfaceId, options.inputManifest)
    }

    await writeArtifactManifest(basePath, result.runId, options.surfaceId, {
      stepId: result.stepId,
      runId: result.runId,
      surfaceId: options.surfaceId,
      compiledPromptPath: options.compiledPrompt ?
        ".threados/runs/" + result.runId + "/surfaces/" + options.surfaceId + "/compiled-prompt.md"
        : null,
      stdoutPath: ".threados/runs/" + result.runId + "/surfaces/" + options.surfaceId + "/logs/stdout.log",
      stderrPath: ".threados/runs/" + result.runId + "/surfaces/" + options.surfaceId + "/logs/stderr.log",
      statusPath: ".threados/runs/" + result.runId + "/surfaces/" + options.surfaceId + "/logs/status.json",
      outputContractRef: options.outputContractRef ?? null,
      completionContract: options.completionContract ?? null,
      createdAt: result.endTime.toISOString(),
      success: result.status === 'SUCCESS',
    })
  }

  return artifactPath
}

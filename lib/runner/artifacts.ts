import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { writeFileAtomic } from '../fs/atomic'
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

export async function createRunDirectory(
  basePath: string,
  runId: string,
  stepId: string,
): Promise<string> {
  const dirPath = join(basePath, RUNS_PATH, runId, stepId)
  await mkdir(dirPath, { recursive: true })
  return dirPath
}

export function getRuntimeEventLogPath(
  basePath: string,
  runId: string,
  stepId: string,
): string {
  return join(basePath, RUNS_PATH, runId, stepId, EVENTS_LOG_FILE)
}

export function getCanonicalRunDir(basePath: string, runId: string): string {
  return join(basePath, RUNS_PATH, runId)
}

export function getCanonicalSurfaceRunDir(basePath: string, runId: string, surfaceId: string): string {
  return join(getCanonicalRunDir(basePath, runId), 'surfaces', surfaceId)
}

async function ensureCanonicalSurfaceDirs(basePath: string, runId: string, surfaceId: string) {
  const surfaceDir = getCanonicalSurfaceRunDir(basePath, runId, surfaceId)
  await mkdir(join(surfaceDir, 'outputs'), { recursive: true })
  await mkdir(join(surfaceDir, 'logs'), { recursive: true })
  await mkdir(join(surfaceDir, 'private'), { recursive: true })
  return surfaceDir
}

export async function writeStdout(artifactPath: string, content: string): Promise<void> {
  const filePath = join(artifactPath, 'stdout.log')
  await writeFile(filePath, content, 'utf-8')
}

export async function writeStderr(artifactPath: string, content: string): Promise<void> {
  const filePath = join(artifactPath, 'stderr.log')
  await writeFile(filePath, content, 'utf-8')
}

export async function writeStatus(artifactPath: string, status: StatusJson): Promise<void> {
  const filePath = join(artifactPath, 'status.json')
  const content = JSON.stringify(status, null, 2)
  await writeFileAtomic(filePath, content)
}

export async function writeRunRecord(basePath: string, record: RunRecordJson): Promise<void> {
  const runDir = getCanonicalRunDir(basePath, record.id)
  const filePath = join(runDir, 'run.json')
  await mkdir(runDir, { recursive: true })
  await writeFileAtomic(filePath, JSON.stringify(record, null, 2))
}

export async function writeCompiledPrompt(
  basePath: string,
  runId: string,
  surfaceId: string,
  compiledPrompt: string,
): Promise<string> {
  const surfaceDir = await ensureCanonicalSurfaceDirs(basePath, runId, surfaceId)
  const filePath = join(surfaceDir, 'compiled-prompt.md')
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
  const filePath = join(surfaceDir, 'input.manifest.json')
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
  const filePath = join(surfaceDir, 'artifact.manifest.json')
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
    const stdoutPath = join(surfaceDir, 'logs', 'stdout.log')
    const stderrPath = join(surfaceDir, 'logs', 'stderr.log')
    const statusPath = join(surfaceDir, 'logs', 'status.json')
    await writeFile(stdoutPath, result.stdout, 'utf-8')
    await writeFile(stderrPath, result.stderr, 'utf-8')
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

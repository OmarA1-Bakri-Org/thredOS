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

/**
 * Create the directory structure for a run's step artifacts
 *
 * @param basePath - The root directory containing .threados/
 * @param runId - The run ID
 * @param stepId - The step ID
 * @returns The full path to the step's artifact directory
 */
export async function createRunDirectory(
  basePath: string,
  runId: string,
  stepId: string
): Promise<string> {
  const dirPath = join(basePath, RUNS_PATH, runId, stepId)
  await mkdir(dirPath, { recursive: true })
  return dirPath
}

export function getRuntimeEventLogPath(
  basePath: string,
  runId: string,
  stepId: string
): string {
  return join(basePath, RUNS_PATH, runId, stepId, EVENTS_LOG_FILE)
}

/**
 * Write stdout log to the artifact directory
 *
 * @param artifactPath - The step's artifact directory path
 * @param content - The stdout content
 */
export async function writeStdout(
  artifactPath: string,
  content: string
): Promise<void> {
  const filePath = join(artifactPath, 'stdout.log')
  await writeFile(filePath, content, 'utf-8')
}

/**
 * Write stderr log to the artifact directory
 *
 * @param artifactPath - The step's artifact directory path
 * @param content - The stderr content
 */
export async function writeStderr(
  artifactPath: string,
  content: string
): Promise<void> {
  const filePath = join(artifactPath, 'stderr.log')
  await writeFile(filePath, content, 'utf-8')
}

/**
 * Write status.json atomically to the artifact directory
 *
 * @param artifactPath - The step's artifact directory path
 * @param status - The status information to write
 */
export async function writeStatus(
  artifactPath: string,
  status: StatusJson
): Promise<void> {
  const filePath = join(artifactPath, 'status.json')
  const content = JSON.stringify(status, null, 2)
  await writeFileAtomic(filePath, content)
}

/**
 * Save all artifacts for a run result
 *
 * @param basePath - The root directory containing .threados/
 * @param result - The run result to save
 */
export async function saveRunArtifacts(
  basePath: string,
  result: RunResult
): Promise<string> {
  const artifactPath = await createRunDirectory(basePath, result.runId, result.stepId)

  // Write logs
  await writeStdout(artifactPath, result.stdout)
  await writeStderr(artifactPath, result.stderr)

  // Write status.json atomically
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

  return artifactPath
}

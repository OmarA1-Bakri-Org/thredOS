import { mkdir } from 'fs/promises'
import { join } from 'path'
import {
  assertSafePathSegment,
  resolveExistingPathWithinRoot,
  resolvePathWithinRoot,
} from '../security/safe-path'

async function ensureDirectory(root: string, ...segments: string[]): Promise<string> {
  const candidate = await resolvePathWithinRoot(root, ...segments)
  await mkdir(candidate, { recursive: true })
  return await resolveExistingPathWithinRoot(root, ...segments)
}

export async function ensureThreadosRoot(basePath: string): Promise<string> {
  return await ensureDirectory(basePath, '.threados')
}

export async function ensureRunsRoot(basePath: string): Promise<string> {
  const threadosRoot = await ensureThreadosRoot(basePath)
  return await ensureDirectory(threadosRoot, 'runs')
}

export async function ensureStateRoot(basePath: string): Promise<string> {
  const threadosRoot = await ensureThreadosRoot(basePath)
  return await ensureDirectory(threadosRoot, 'state')
}

export async function ensureRunDirectory(basePath: string, runId: string): Promise<string> {
  assertSafePathSegment(runId, 'run id')
  return await ensureDirectory(await ensureRunsRoot(basePath), runId)
}

export async function runRecordPath(basePath: string, runId: string): Promise<string> {
  return await resolvePathWithinRoot(await ensureRunDirectory(basePath, runId), 'run.json')
}

export async function ensureAttemptsDirectory(basePath: string, runId: string): Promise<string> {
  return await ensureDirectory(await ensureRunDirectory(basePath, runId), 'attempts')
}

export async function ensureAttemptDirectory(
  basePath: string,
  runId: string,
  attemptId: string,
): Promise<string> {
  assertSafePathSegment(attemptId, 'attempt id')
  return await ensureDirectory(await ensureAttemptsDirectory(basePath, runId), attemptId)
}

export async function attemptRecordPath(basePath: string, runId: string, attemptId: string): Promise<string> {
  return await resolvePathWithinRoot(await ensureAttemptDirectory(basePath, runId, attemptId), 'attempt.json')
}

export async function processRecordPath(basePath: string, runId: string, attemptId: string): Promise<string> {
  return await resolvePathWithinRoot(await ensureAttemptDirectory(basePath, runId, attemptId), 'process.json')
}

export async function ensureCommandsRoot(basePath: string): Promise<string> {
  return await ensureDirectory(await ensureStateRoot(basePath), 'runtime-commands')
}

export async function commandRecordPath(basePath: string, commandId: string): Promise<string> {
  assertSafePathSegment(commandId, 'command id')
  return await resolvePathWithinRoot(await ensureCommandsRoot(basePath), `${commandId}.json`)
}

export async function commandIdempotencyLockPath(basePath: string, digest: string): Promise<string> {
  assertSafePathSegment(digest, 'idempotency digest')
  const locks = await ensureDirectory(await ensureCommandsRoot(basePath), '.idempotency-locks')
  return join(locks, `${digest}.lock`)
}

export async function runtimeIndexPath(basePath: string): Promise<string> {
  return await resolvePathWithinRoot(await ensureStateRoot(basePath), 'runtime-index.json')
}

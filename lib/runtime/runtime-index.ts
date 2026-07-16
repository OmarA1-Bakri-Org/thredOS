import { createHash } from 'crypto'
import { readdir } from 'fs/promises'
import { relative, sep } from 'path'
import { z } from 'zod'
import { withExclusiveFileLock, writeFileAtomic } from '../fs/atomic'
import {
  assertPortableRelativePath,
  assertSafePathSegment,
  resolveExistingPathWithinRoot,
} from '../security/safe-path'
import { readTextFileNoFollow } from '../security/safe-io'
import { ProcessRecordSchema, RuntimeCommandReceiptSchema, StepAttemptSchema, WorkflowRunSchema } from './schema'
import {
  lookupCommandsRoot,
  lookupRunsRoot,
  lookupRuntimeIndexPath,
  runtimeIndexPath,
} from './paths'

const PortableReferenceSchema = z.string().refine(value => {
  try {
    assertPortableRelativePath(value, 'runtime index reference')
    return true
  } catch {
    return false
  }
}, 'runtime index reference must be a portable relative path')

const RuntimeIndexSchema = z.object({
  schema_version: z.literal(1),
  runs: z.record(z.string(), PortableReferenceSchema),
  attempts: z.record(z.string(), PortableReferenceSchema),
  processes: z.record(z.string(), PortableReferenceSchema),
  commands: z.record(z.string(), PortableReferenceSchema),
  idempotency: z.record(z.string(), z.object({
    request_hash: z.string(),
    receipt_ref: PortableReferenceSchema,
  })),
})

export type RuntimeIndex = z.infer<typeof RuntimeIndexSchema>

export function idempotencyDigest(key: string): string {
  return createHash('sha256').update(key, 'utf-8').digest('hex')
}

function portableReference(basePath: string, filePath: string): string {
  return relative(basePath, filePath).split(sep).join('/')
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readTextFileNoFollow(path))
}

function emptyRuntimeIndex(): RuntimeIndex {
  return {
    schema_version: 1,
    runs: {},
    attempts: {},
    processes: {},
    commands: {},
    idempotency: {},
  }
}

export async function scanAuthoritativeRuntimeIndex(basePath: string): Promise<RuntimeIndex> {
  const index = emptyRuntimeIndex()
  const runsRoot = await lookupRunsRoot(basePath)
  if (runsRoot) for (const runEntry of await readdir(runsRoot, { withFileTypes: true })) {
    if (!runEntry.isDirectory()) continue
    assertSafePathSegment(runEntry.name, 'run id')
    const runDir = await resolveExistingPathWithinRoot(runsRoot, runEntry.name)
    const runPath = await resolveExistingPathWithinRoot(runDir, 'run.json').catch(() => null)
    if (runPath) {
      const parsed = WorkflowRunSchema.safeParse(await readJson(runPath).catch(() => null))
      if (parsed.success && parsed.data.id === runEntry.name) {
        index.runs[parsed.data.id] = portableReference(basePath, runPath)
      }
    }
    const attemptsRoot = await resolveExistingPathWithinRoot(runDir, 'attempts').catch(() => null)
    if (!attemptsRoot) continue
    for (const attemptEntry of await readdir(attemptsRoot, { withFileTypes: true })) {
      if (!attemptEntry.isDirectory()) continue
      assertSafePathSegment(attemptEntry.name, 'attempt id')
      const attemptDir = await resolveExistingPathWithinRoot(attemptsRoot, attemptEntry.name)
      const attemptPath = await resolveExistingPathWithinRoot(attemptDir, 'attempt.json').catch(() => null)
      if (attemptPath) {
        const parsed = StepAttemptSchema.safeParse(await readJson(attemptPath).catch(() => null))
        if (parsed.success && parsed.data.id === attemptEntry.name && parsed.data.workflow_run_id === runEntry.name) {
          index.attempts[parsed.data.id] = portableReference(basePath, attemptPath)
        }
      }
      const processPath = await resolveExistingPathWithinRoot(attemptDir, 'process.json').catch(() => null)
      if (processPath) {
        const parsed = ProcessRecordSchema.safeParse(await readJson(processPath).catch(() => null))
        if (parsed.success && parsed.data.attempt_id === attemptEntry.name && parsed.data.workflow_run_id === runEntry.name) {
          index.processes[parsed.data.id] = portableReference(basePath, processPath)
        }
      }
    }
  }

  const commandsRoot = await lookupCommandsRoot(basePath)
  if (commandsRoot) for (const entry of await readdir(commandsRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const commandPath = await resolveExistingPathWithinRoot(commandsRoot, entry.name)
    const parsed = RuntimeCommandReceiptSchema.safeParse(await readJson(commandPath).catch(() => null))
    if (!parsed.success) continue
    const reference = portableReference(basePath, commandPath)
    index.commands[parsed.data.id] = reference
    index.idempotency[idempotencyDigest(parsed.data.idempotency_key)] = {
      request_hash: parsed.data.request_hash,
      receipt_ref: reference,
    }
  }
  return index
}

export async function rebuildRuntimeIndex(basePath: string, lockTimeoutMs = 5_000): Promise<RuntimeIndex> {
  const indexPath = await runtimeIndexPath(basePath)
  return await withExclusiveFileLock(`${indexPath}.lock`, async () => {
    const rebuilt = await scanAuthoritativeRuntimeIndex(basePath)
    await writeFileAtomic(indexPath, `${JSON.stringify(rebuilt, null, 2)}\n`, { allowedRoot: basePath })
    return rebuilt
  }, { allowedRoot: basePath, timeoutMs: lockTimeoutMs })
}

export async function readRuntimeIndex(basePath: string): Promise<RuntimeIndex> {
  const indexPath = await lookupRuntimeIndexPath(basePath)
  if (!indexPath) return await scanAuthoritativeRuntimeIndex(basePath)
  try {
    return RuntimeIndexSchema.parse(JSON.parse(await readTextFileNoFollow(indexPath)))
  } catch {
    try {
      return await rebuildRuntimeIndex(basePath)
    } catch {
      return await scanAuthoritativeRuntimeIndex(basePath)
    }
  }
}

export async function refreshRuntimeIndexBestEffort(basePath: string): Promise<void> {
  await rebuildRuntimeIndex(basePath, 25).catch(() => undefined)
}

export async function resolveRuntimeIndexReference(basePath: string, reference: string): Promise<string> {
  assertPortableRelativePath(reference, 'runtime index reference')
  const segments = reference.split('/')
  return await resolveExistingPathWithinRoot(basePath, ...segments)
}

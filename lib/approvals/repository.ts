import { mkdir } from 'fs/promises'
import { ApprovalSchema, type Approval } from '@/lib/contracts/schemas'
import { withExclusiveFileLock, writeFileAtomic } from '@/lib/fs/atomic'
import {
  assertSafePathSegment,
  resolveExistingPathWithinRoot,
  resolvePathWithinRoot,
} from '@/lib/security/safe-path'
import { readTextFileNoFollow } from '@/lib/security/safe-io'

async function ensureRunsRoot(basePath: string): Promise<string> {
  const threadosPath = await resolvePathWithinRoot(basePath, '.threados')
  await mkdir(threadosPath, { recursive: true })
  const threadosRoot = await resolveExistingPathWithinRoot(basePath, '.threados')
  const runsRoot = await resolvePathWithinRoot(threadosRoot, 'runs')
  await mkdir(runsRoot, { recursive: true })
  return await resolveExistingPathWithinRoot(threadosRoot, 'runs')
}

async function ensureRunDir(basePath: string, runId: string): Promise<string> {
  const runsRoot = await ensureRunsRoot(basePath)
  const dirPath = await resolvePathWithinRoot(runsRoot, runId)
  await mkdir(dirPath, { recursive: true })
  return await resolveExistingPathWithinRoot(runsRoot, runId)
}

async function resolveApprovalsFilePath(basePath: string, runId: string): Promise<string> {
  const runDir = await ensureRunDir(basePath, runId)
  return await resolvePathWithinRoot(runDir, 'approvals.ndjson')
}

async function resolveApprovalsLockPath(basePath: string, runId: string): Promise<string> {
  const runDir = await ensureRunDir(basePath, runId)
  return await resolvePathWithinRoot(runDir, 'approvals.ndjson.lock')
}

async function resolveExistingApprovalsPaths(basePath: string, runId: string): Promise<{
  filePath: string
  lockPath: string
} | null> {
  try {
    const threadosRoot = await resolveExistingPathWithinRoot(basePath, '.threados')
    const runsRoot = await resolveExistingPathWithinRoot(threadosRoot, 'runs')
    const runDir = await resolveExistingPathWithinRoot(runsRoot, runId)
    return {
      filePath: await resolvePathWithinRoot(runDir, 'approvals.ndjson'),
      lockPath: await resolvePathWithinRoot(runDir, 'approvals.ndjson.lock'),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function foldApprovals(entries: Approval[]): Approval[] {
  const indexById = new Map<string, number>()
  const folded: Approval[] = []

  for (const entry of entries) {
    const existingIndex = indexById.get(entry.id)
    if (existingIndex == null) {
      indexById.set(entry.id, folded.length)
      folded.push(entry)
      continue
    }
    folded[existingIndex] = {
      ...folded[existingIndex],
      ...entry,
    }
  }

  return folded
}

function serializeApprovals(entries: Approval[]): string {
  return entries.map(entry => JSON.stringify(ApprovalSchema.parse(entry))).join('\n') + '\n'
}

async function writeApprovalsSnapshot(
  filePath: string,
  approvals: Approval[],
  allowedRoot: string,
): Promise<void> {
  await writeFileAtomic(filePath, serializeApprovals(approvals), { allowedRoot })
}

async function readApprovalsFile(filePath: string): Promise<Approval[]> {
  try {
    const content = await readTextFileNoFollow(filePath)
    const lines = content.trim().split('\n').filter(Boolean)
    return lines.map(line => ApprovalSchema.parse(JSON.parse(line)))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

export class ApprovalResolutionError extends Error {
  constructor(
    public readonly code:
      | 'APPROVAL_ALREADY_EXISTS'
      | 'APPROVAL_NOT_FOUND'
      | 'APPROVAL_ALREADY_RESOLVED'
      | 'APPROVAL_EXPIRED'
      | 'APPROVAL_BINDING_MISMATCH',
    message: string,
  ) {
    super(message)
    this.name = 'ApprovalResolutionError'
  }
}

export async function appendApproval(
  basePath: string,
  runId: string,
  approval: Approval,
): Promise<void> {
  assertSafePathSegment(runId, 'run id')
  const filePath = await resolveApprovalsFilePath(basePath, runId)
  const lockPath = await resolveApprovalsLockPath(basePath, runId)
  await withExclusiveFileLock(lockPath, async () => {
    const approvals = await readApprovalsFile(filePath)
    await writeApprovalsSnapshot(
      filePath,
      [...approvals, ApprovalSchema.parse(approval)],
      basePath,
    )
  }, { allowedRoot: basePath })
}

export async function readApprovals(
  basePath: string,
  runId: string,
): Promise<Approval[]> {
  assertSafePathSegment(runId, 'run id')
  const existingPaths = await resolveExistingApprovalsPaths(basePath, runId)
  if (!existingPaths) return []
  return await withExclusiveFileLock(existingPaths.lockPath, async () => {
    return await readApprovalsFile(existingPaths.filePath)
  }, { allowedRoot: basePath })
}

export async function appendApprovalLifecycle(
  basePath: string,
  runId: string,
  pendingApproval: Approval,
  terminalApproval: Approval,
): Promise<Approval> {
  assertSafePathSegment(runId, 'run id')
  const filePath = await resolveApprovalsFilePath(basePath, runId)
  const lockPath = await resolveApprovalsLockPath(basePath, runId)

  return await withExclusiveFileLock(lockPath, async () => {
    const approvals = await readApprovalsFile(filePath)
    const currentApproval = foldApprovals(approvals).find(entry => entry.id === pendingApproval.id) ?? null
    if (currentApproval) {
      throw new ApprovalResolutionError('APPROVAL_ALREADY_EXISTS', 'Approval already exists')
    }

    const validatedPending = ApprovalSchema.parse(pendingApproval)
    const validatedTerminal = ApprovalSchema.parse(terminalApproval)
    if (validatedPending.id !== validatedTerminal.id) {
      throw new Error('Approval lifecycle records must preserve one approval id')
    }
    if (validatedPending.status !== 'pending') {
      throw new Error('Approval lifecycle must start with a pending record')
    }
    if (validatedTerminal.status === 'pending') {
      throw new Error('Approval lifecycle terminal record must not be pending')
    }

    await writeApprovalsSnapshot(
      filePath,
      [...approvals, validatedPending, validatedTerminal],
      basePath,
    )
    return validatedTerminal
  }, { allowedRoot: basePath })
}

export async function resolvePendingApproval(
  basePath: string,
  runId: string,
  approvalId: string,
  resolveApproval: (pendingApproval: Approval) => Approval,
): Promise<Approval> {
  assertSafePathSegment(runId, 'run id')
  const filePath = await resolveApprovalsFilePath(basePath, runId)
  const lockPath = await resolveApprovalsLockPath(basePath, runId)

  return await withExclusiveFileLock(lockPath, async () => {
    const approvals = await readApprovalsFile(filePath)
    const currentApproval = foldApprovals(approvals).find(entry => entry.id === approvalId) ?? null

    if (!currentApproval) {
      throw new ApprovalResolutionError('APPROVAL_NOT_FOUND', 'Approval not found')
    }
    if (currentApproval.status !== 'pending') {
      throw new ApprovalResolutionError('APPROVAL_ALREADY_RESOLVED', 'Approval already resolved')
    }

    const resolvedApproval = ApprovalSchema.parse(resolveApproval(currentApproval))
    if (resolvedApproval.id !== currentApproval.id) {
      throw new Error('Resolved approval must preserve the pending approval id')
    }
    if (resolvedApproval.status === 'pending') {
      throw new Error('Resolved approval must be terminal')
    }

    await writeApprovalsSnapshot(
      filePath,
      [...approvals, resolvedApproval],
      basePath,
    )
    return resolvedApproval
  }, { allowedRoot: basePath })
}

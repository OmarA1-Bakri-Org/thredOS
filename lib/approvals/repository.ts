import { mkdir } from 'fs/promises'
import { ApprovalSchema, type Approval } from '@/lib/contracts/schemas'
import { withExclusiveFileLock, writeFileAtomic } from '@/lib/fs/atomic'
import { hasExactApprovalBinding, isApprovalExpired } from '@/lib/approvals/binding'
import { approvalMatchesExecutableSubject } from '@/lib/policy/executable'
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

export function foldApprovals(entries: Approval[]): Approval[] {
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

function assertApprovalLifecycleIdentity(entries: Approval[]): void {
  const [first, ...rest] = entries
  if (!first) throw new Error('Approval lifecycle requires at least one record')
  for (const entry of rest) {
    if (entry.id !== first.id) {
      throw new Error('Approval lifecycle records must preserve one approval id')
    }
  }
}

function assertConsumedLifecycle(
  pendingApproval: Approval,
  approvedApproval: Approval,
  consumedApproval: Approval,
): void {
  assertApprovalLifecycleIdentity([pendingApproval, approvedApproval, consumedApproval])
  if (pendingApproval.status !== 'pending') {
    throw new Error('Approval lifecycle must start with a pending record')
  }
  if (approvedApproval.status !== 'approved') {
    throw new Error('Consumed approval lifecycle must include an approved record before consumption')
  }
  if (consumedApproval.status !== 'approved') {
    throw new Error('Consumed approval lifecycle terminal record must remain approved')
  }
  if (!hasExactApprovalBinding(approvedApproval) || !hasExactApprovalBinding(consumedApproval)) {
    throw new Error('Consumed approval lifecycle requires exact runtime approval binding')
  }
  if (approvedApproval.consumed_at != null || approvedApproval.consumed_by != null) {
    throw new Error('Approved approval must remain unconsumed before the terminal consumed record')
  }
  if (consumedApproval.consumed_at == null || consumedApproval.consumed_by == null) {
    throw new Error('Consumed approval lifecycle terminal record requires consumed_at and consumed_by')
  }
  const preservedFields: Array<keyof Approval> = [
    'action_type',
    'target_ref',
    'requested_by',
    'approved_by',
    'approved_at',
    'notes',
    'subject_digest',
    'payload_ref',
    'policy_ref',
    'precondition_hash',
    'expires_at',
  ]
  for (const field of preservedFields) {
    if (approvedApproval[field] !== consumedApproval[field]) {
      throw new Error(`Consumed approval lifecycle must preserve approved field ${field}`)
    }
  }
}

export class ApprovalResolutionError extends Error {
  constructor(
    public readonly code:
      | 'APPROVAL_ALREADY_EXISTS'
      | 'APPROVAL_NOT_FOUND'
      | 'APPROVAL_NOT_APPROVED'
      | 'APPROVAL_ALREADY_RESOLVED'
      | 'APPROVAL_ALREADY_CONSUMED'
      | 'APPROVAL_EXPIRED'
      | 'APPROVAL_BINDING_MISMATCH',
    message: string,
  ) {
    super(message)
    this.name = 'ApprovalResolutionError'
  }
}

export class ApprovalConsumptionError extends Error {
  constructor(
    public readonly code:
      | 'APPROVAL_NOT_FOUND'
      | 'APPROVAL_NOT_APPROVED'
      | 'APPROVAL_ALREADY_CONSUMED'
      | 'APPROVAL_EXPIRED'
      | 'APPROVAL_BINDING_MISMATCH',
    message: string,
  ) {
    super(message)
    this.name = 'ApprovalConsumptionError'
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
    assertApprovalLifecycleIdentity([validatedPending, validatedTerminal])
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

export async function appendConsumedApprovalLifecycle(
  basePath: string,
  runId: string,
  pendingApproval: Approval,
  approvedApproval: Approval,
  consumedApproval: Approval,
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
    const validatedApproved = ApprovalSchema.parse(approvedApproval)
    const validatedConsumed = ApprovalSchema.parse(consumedApproval)
    assertConsumedLifecycle(validatedPending, validatedApproved, validatedConsumed)

    await writeApprovalsSnapshot(
      filePath,
      [...approvals, validatedPending, validatedApproved, validatedConsumed],
      basePath,
    )
    return validatedConsumed
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

export interface ConsumeApprovalInput {
  targetRefs: string[]
  subjectDigest: string
  consumedAt: string
  consumedBy: string
}

export async function consumeApproval(
  basePath: string,
  runId: string,
  approvalId: string,
  input: ConsumeApprovalInput,
): Promise<Approval> {
  assertSafePathSegment(runId, 'run id')
  const filePath = await resolveApprovalsFilePath(basePath, runId)
  const lockPath = await resolveApprovalsLockPath(basePath, runId)

  return await withExclusiveFileLock(lockPath, async () => {
    const approvals = await readApprovalsFile(filePath)
    const currentApproval = foldApprovals(approvals).find(entry => entry.id === approvalId) ?? null

    if (!currentApproval) {
      throw new ApprovalConsumptionError('APPROVAL_NOT_FOUND', 'Approval not found')
    }
    if (currentApproval.status !== 'approved') {
      throw new ApprovalConsumptionError('APPROVAL_NOT_APPROVED', 'Approval is not approved')
    }
    if (currentApproval.consumed_at != null) {
      throw new ApprovalConsumptionError('APPROVAL_ALREADY_CONSUMED', 'Approval already consumed')
    }
    if (isApprovalExpired(currentApproval)) {
      throw new ApprovalConsumptionError('APPROVAL_EXPIRED', 'Approval expired')
    }
    if (!approvalMatchesExecutableSubject(
      currentApproval,
      input.targetRefs,
      input.subjectDigest,
    )) {
      throw new ApprovalConsumptionError(
        'APPROVAL_BINDING_MISMATCH',
        'Approval does not match the expected executable subject',
      )
    }

    const consumedApproval = ApprovalSchema.parse({
      ...currentApproval,
      consumed_at: input.consumedAt,
      consumed_by: input.consumedBy,
    })
    await writeApprovalsSnapshot(
      filePath,
      [...approvals, consumedApproval],
      basePath,
    )
    return consumedApproval
  }, { allowedRoot: basePath })
}

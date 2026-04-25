import { appendFile, readFile, mkdir, readdir } from 'fs/promises'
import { join } from 'path'
import { ApprovalSchema, type Approval } from '@/lib/contracts/schemas'

const RUNS_PATH = '.threados/runs'

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

export async function appendApproval(
  basePath: string,
  runId: string,
  approval: Approval,
): Promise<void> {
  const validated = ApprovalSchema.parse(approval)
  const dirPath = join(basePath, RUNS_PATH, runId)
  await mkdir(dirPath, { recursive: true })
  const filePath = join(dirPath, 'approvals.ndjson')
  await appendFile(filePath, JSON.stringify(validated) + '\n', 'utf-8')
}

export async function readApprovals(
  basePath: string,
  runId: string,
): Promise<Approval[]> {
  const filePath = join(basePath, RUNS_PATH, runId, 'approvals.ndjson')
  let content: string
  try {
    content = await readFile(filePath, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const lines = content.trim().split('\n').filter(Boolean)
  return lines.map(line => ApprovalSchema.parse(JSON.parse(line)))
}

export async function hasApprovedApproval(
  basePath: string,
  targetRef: string,
  actionType: Approval['action_type'] = 'run',
): Promise<boolean> {
  const runsPath = join(basePath, RUNS_PATH)
  let runEntries: string[]
  try {
    runEntries = await readdir(runsPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }

  for (const runId of runEntries) {
    const approvals = foldApprovals(await readApprovals(basePath, runId))
    if (approvals.some(approval => approval.action_type === actionType && approval.target_ref === targetRef && approval.status === 'approved')) {
      return true
    }
  }

  return false
}

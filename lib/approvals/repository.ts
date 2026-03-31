import { appendFile, readFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { ApprovalSchema, type Approval } from '@/lib/contracts/schemas'

const RUNS_PATH = '.threados/runs'

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

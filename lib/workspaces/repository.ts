import { mkdir } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod'
import { withExclusiveFileLock, writeFileAtomic } from '@/lib/fs/atomic'
import { readTextFileNoFollow } from '@/lib/security/safe-io'
import { assertSafePathSegment, resolveExistingPathWithinRoot } from '@/lib/security/safe-path'
import { RuntimeRepositoryError } from '@/lib/runtime/run-repository'
import { SurfaceWorkspaceSchema, type SurfaceWorkspace } from './schema'

const WorkspaceIndexSchema = z.object({
  schema_version: z.literal(1),
  revision: z.number().int().nonnegative(),
  workspaces: z.array(SurfaceWorkspaceSchema),
}).superRefine((index, context) => {
  const seen = new Set<string>()
  index.workspaces.forEach((workspace, offset) => {
    if (seen.has(workspace.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['workspaces', offset, 'id'],
        message: `Duplicate workspace id: ${workspace.id}`,
      })
    }
    seen.add(workspace.id)
  })
})
export type WorkspaceIndex = z.infer<typeof WorkspaceIndexSchema>
export type WorkspaceMutation = (current: SurfaceWorkspace) => SurfaceWorkspace

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function emptyIndex(): WorkspaceIndex {
  return { schema_version: 1, revision: 0, workspaces: [] }
}

export function getWorkspaceIndexPath(basePath: string): string {
  return join(basePath, '.threados', 'workspaces', 'index.json')
}

async function readIndex(basePath: string): Promise<WorkspaceIndex> {
  try {
    const path = await resolveExistingPathWithinRoot(
      basePath,
      '.threados',
      'workspaces',
      'index.json',
    )
    return WorkspaceIndexSchema.parse(JSON.parse(await readTextFileNoFollow(path)))
  } catch (error) {
    if (isMissing(error)) return emptyIndex()
    throw error
  }
}

async function writeIndex(basePath: string, index: WorkspaceIndex): Promise<void> {
  const parsed = WorkspaceIndexSchema.parse(index)
  await mkdir(join(basePath, '.threados', 'workspaces'), { recursive: true })
  await writeFileAtomic(
    getWorkspaceIndexPath(basePath),
    `${JSON.stringify(parsed, null, 2)}\n`,
    { allowedRoot: basePath },
  )
}

export class WorkspaceRepository {
  constructor(private readonly basePath: string) {}

  async list(): Promise<SurfaceWorkspace[]> {
    return (await readIndex(this.basePath)).workspaces
      .sort((left, right) => left.id.localeCompare(right.id))
  }

  async get(workspaceId: string): Promise<SurfaceWorkspace | null> {
    assertSafePathSegment(workspaceId, 'workspace id')
    return (await readIndex(this.basePath)).workspaces.find(item => item.id === workspaceId) ?? null
  }

  async create(value: SurfaceWorkspace): Promise<void> {
    const workspace = SurfaceWorkspaceSchema.parse(value)
    assertSafePathSegment(workspace.id, 'workspace id')
    if (workspace.revision !== 0) {
      throw new RuntimeRepositoryError('RUNTIME_REVISION_CONFLICT', 'new workspace records must start at revision 0')
    }
    const indexPath = getWorkspaceIndexPath(this.basePath)
    await mkdir(join(this.basePath, '.threados', 'workspaces'), { recursive: true })
    await withExclusiveFileLock(`${indexPath}.lock`, async () => {
      const index = await readIndex(this.basePath)
      if (index.workspaces.some(item => item.id === workspace.id)) {
        throw new RuntimeRepositoryError('RUNTIME_RECORD_EXISTS', `workspace ${workspace.id} already exists`)
      }
      await writeIndex(this.basePath, {
        ...index,
        revision: index.revision + 1,
        workspaces: [...index.workspaces, workspace],
      })
    }, { allowedRoot: this.basePath })
  }

  async update(
    workspaceId: string,
    expectedRevision: number,
    mutate: WorkspaceMutation,
  ): Promise<SurfaceWorkspace> {
    assertSafePathSegment(workspaceId, 'workspace id')
    const indexPath = getWorkspaceIndexPath(this.basePath)
    return await withExclusiveFileLock(`${indexPath}.lock`, async () => {
      const index = await readIndex(this.basePath)
      const offset = index.workspaces.findIndex(item => item.id === workspaceId)
      if (offset === -1) {
        throw new RuntimeRepositoryError('WORKSPACE_NOT_FOUND', `workspace ${workspaceId} was not found`)
      }
      const current = index.workspaces[offset]
      if (current.revision !== expectedRevision) {
        throw new RuntimeRepositoryError(
          'RUNTIME_REVISION_CONFLICT',
          `workspace ${workspaceId} revision ${current.revision} does not match expected ${expectedRevision}`,
        )
      }
      const candidate = mutate(structuredClone(current))
      const next = SurfaceWorkspaceSchema.parse({
        ...candidate,
        id: current.id,
        revision: current.revision + 1,
      })
      const workspaces = [...index.workspaces]
      workspaces[offset] = next
      await writeIndex(this.basePath, { ...index, revision: index.revision + 1, workspaces })
      return next
    }, { allowedRoot: this.basePath })
  }
}

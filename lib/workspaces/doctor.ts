import { lstat, readdir, realpath } from 'fs/promises'
import { dirname, isAbsolute, join } from 'path'
import { resolveExistingPathWithinRoot } from '@/lib/security/safe-path'
import type { SnapshotRepository } from './snapshot-repository'
import type { SurfaceWorkspace } from './schema'
import { copyWorkspaceTreePath, verifyWorkspaceTree } from './providers/copy'

export type WorkspaceDoctorIssueCode =
  | 'WORKSPACE_TREE_MISSING'
  | 'WORKSPACE_MANIFEST_INVALID'
  | 'WORKSPACE_ORPHANED_DIRECTORY'
  | 'WORKSPACE_RECORD_INVALID'
  | 'WORKSPACE_STORAGE_UNSAFE'
  | 'WORKSPACE_RECOVERY_REQUIRED'

export interface WorkspaceDoctorIssue {
  code: WorkspaceDoctorIssueCode
  workspaceId: string | null
  path: string | null
  message: string
}

export interface WorkspaceDoctorReport {
  healthy: boolean
  checkedRecords: number
  checkedDirectories: number
  issues: WorkspaceDoctorIssue[]
}

export interface WorkspaceDoctorRepository {
  list(): Promise<SurfaceWorkspace[]>
}

export interface DoctorWorkspacesOptions {
  repository: WorkspaceDoctorRepository
  snapshotRepository: SnapshotRepository
  workspacesRoot: string
}

const TREE_REQUIRED_STATUSES = new Set<SurfaceWorkspace['status']>([
  'ready',
  'active',
  'frozen',
  'retained',
  'cleaning',
])

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function comparablePath(value: string): string {
  return process.platform === 'win32' ? value.toLocaleLowerCase('en-US') : value
}

function isExactAbsolutePath(left: string, right: string): boolean {
  if (!isAbsolute(left) || !isAbsolute(right)) return false
  if (left.split(/[\\/]/).some(segment => segment === '.' || segment === '..')) return false
  if (right.split(/[\\/]/).some(segment => segment === '.' || segment === '..')) return false
  return comparablePath(left) === comparablePath(right)
}

export async function doctorWorkspaces(
  options: DoctorWorkspacesOptions,
): Promise<WorkspaceDoctorReport> {
  const issues: WorkspaceDoctorIssue[] = []
  let verifiedWorkspacesRoot: string
  let storageRootSafe = true
  try {
    const rootStat = await lstat(options.workspacesRoot)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('not a plain directory')
    verifiedWorkspacesRoot = await realpath(options.workspacesRoot)
    if (!isExactAbsolutePath(options.workspacesRoot, verifiedWorkspacesRoot)) {
      throw new Error('workspace root is not canonical')
    }
  } catch (error) {
    if (!isMissing(error)) {
      storageRootSafe = false
      issues.push({
        code: 'WORKSPACE_STORAGE_UNSAFE',
        workspaceId: null,
        path: options.workspacesRoot,
        message: error instanceof Error ? error.message : 'Workspace storage root is unsafe',
      })
    }
    verifiedWorkspacesRoot = options.workspacesRoot
  }
  let records: SurfaceWorkspace[]
  try {
    records = await options.repository.list()
  } catch (error) {
    issues.push({
      code: 'WORKSPACE_RECORD_INVALID',
      workspaceId: null,
      path: null,
      message: error instanceof Error ? error.message : 'Workspace records are invalid',
    })
    return { healthy: false, checkedRecords: 0, checkedDirectories: 0, issues }
  }

  if (!storageRootSafe) {
    return {
      healthy: false,
      checkedRecords: records.length,
      checkedDirectories: 0,
      issues,
    }
  }

  for (const workspace of records) {
    if (
      workspace.status === 'materializing'
      || workspace.status === 'failed' && workspace.error_code === 'WORKSPACE_RECOVERY_REQUIRED'
    ) {
      issues.push({
        code: 'WORKSPACE_RECOVERY_REQUIRED',
        workspaceId: workspace.id,
        path: workspace.root_path,
        message: `Workspace ${workspace.status} state requires operator recovery`,
      })
    }
    const recoveryFailed = workspace.status === 'failed'
      && workspace.error_code === 'WORKSPACE_RECOVERY_REQUIRED'
    if (!TREE_REQUIRED_STATUSES.has(workspace.status) && !recoveryFailed) continue
    const expectedRoot = copyWorkspaceTreePath(
      verifiedWorkspacesRoot,
      workspace.workflow_run_id,
      workspace.id,
    )
    if (!isExactAbsolutePath(workspace.root_path, expectedRoot)) {
      issues.push({
        code: 'WORKSPACE_STORAGE_UNSAFE',
        workspaceId: workspace.id,
        path: workspace.root_path,
        message: 'Workspace root_path does not match provider-owned storage',
      })
      continue
    }
    let exists = false
    try {
      const containedRoot = await resolveExistingPathWithinRoot(
        verifiedWorkspacesRoot,
        workspace.workflow_run_id,
        workspace.id,
        'tree',
      )
      const stat = await lstat(containedRoot)
      exists = stat.isDirectory() && !stat.isSymbolicLink()
      if (!exists) {
        issues.push({
          code: 'WORKSPACE_STORAGE_UNSAFE',
          workspaceId: workspace.id,
          path: workspace.root_path,
          message: 'Workspace tree is not a plain directory',
        })
      }
    } catch (error) {
      if (!isMissing(error)) throw error
    }
    if (!exists) {
      if (!issues.some(issue => issue.workspaceId === workspace.id && issue.code === 'WORKSPACE_STORAGE_UNSAFE')) {
        issues.push({
          code: 'WORKSPACE_TREE_MISSING',
          workspaceId: workspace.id,
          path: workspace.root_path,
          message: 'Workspace record requires a tree, but the tree is missing',
        })
      }
      continue
    }

    const snapshot = await options.snapshotRepository.get(workspace.snapshot_id)
    const manifest = await options.snapshotRepository.getManifest(workspace.snapshot_id)
    if (
      !snapshot
      || snapshot.status !== 'ready'
      || !manifest
      || workspace.manifest_hash !== manifest.root_manifest_hash
    ) {
      issues.push({
        code: 'WORKSPACE_MANIFEST_INVALID',
        workspaceId: workspace.id,
        path: workspace.root_path,
        message: 'Workspace manifest binding is missing or does not match its snapshot',
      })
      continue
    }
    try {
      await verifyWorkspaceTree(workspace.root_path, manifest)
    } catch (error) {
      issues.push({
        code: 'WORKSPACE_MANIFEST_INVALID',
        workspaceId: workspace.id,
        path: workspace.root_path,
        message: error instanceof Error ? error.message : 'Workspace tree does not match its manifest',
      })
    }
  }

  const knownContainers = new Set(records
    .filter(record => record.status !== 'cleaned')
    .map(record => comparablePath(dirname(copyWorkspaceTreePath(
      verifiedWorkspacesRoot,
      record.workflow_run_id,
      record.id,
    )))))
  let checkedDirectories = 0
  try {
    const runs = await readdir(verifiedWorkspacesRoot, { withFileTypes: true })
    for (const run of runs) {
      const runPath = join(verifiedWorkspacesRoot, run.name)
      const runStat = await lstat(runPath)
      if (!run.isDirectory() || runStat.isSymbolicLink()) {
        issues.push({
          code: 'WORKSPACE_STORAGE_UNSAFE',
          workspaceId: null,
          path: runPath,
          message: 'Workspace run entry is not a plain directory',
        })
        continue
      }
      const containers = await readdir(runPath, { withFileTypes: true })
      for (const container of containers) {
        const containerPath = join(runPath, container.name)
        const containerStat = await lstat(containerPath)
        checkedDirectories += 1
        if (!container.isDirectory() || containerStat.isSymbolicLink()) {
          issues.push({
            code: 'WORKSPACE_STORAGE_UNSAFE',
            workspaceId: null,
            path: containerPath,
            message: 'Workspace container is not a plain directory',
          })
          continue
        }
        if (!knownContainers.has(comparablePath(containerPath))) {
          issues.push({
            code: 'WORKSPACE_ORPHANED_DIRECTORY',
            workspaceId: null,
            path: containerPath,
            message: 'Workspace directory has no canonical record',
          })
        }
      }
    }
  } catch (error) {
    if (!isMissing(error)) throw error
  }

  return {
    healthy: issues.length === 0,
    checkedRecords: records.length,
    checkedDirectories,
    issues,
  }
}

import { mkdir } from 'fs/promises'
import { basename, join } from 'path'
import { z } from 'zod'
import { writeFileAtomic } from '@/lib/fs/atomic'
import { readTextFileNoFollow } from '@/lib/security/safe-io'
import { resolveExistingPathWithinRoot, resolvePathWithinRoot } from '@/lib/security/safe-path'
import { loadWorkspaceConfig } from '@/lib/workspaces/config'
import type { WorkspaceConfig } from '@/lib/workspaces/config-schema'
import { buildExclusionPolicy } from '@/lib/workspaces/exclusions'
import {
  canonicalizeProspectivePath,
  resolveRuntimeDataRoot,
  resolveWorkspaceRuntimePaths,
} from '@/lib/workspaces/paths'
import type { LocalWorkspace } from './types'

const LOCAL_WORKSPACE_STATE_PATH = '.threados/state/local-workspace.json'
const WorkspaceIdentityCompatibilitySchema = z.object({
  id: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  createdAt: z.string().datetime().optional(),
  lastOpenedAt: z.string().datetime().optional(),
  runtimeTarget: z.enum(['desktop', 'node']).optional(),
}).passthrough()

export interface WorkspaceIdentity {
  id: string
  label: string
  createdAt: string
  lastOpenedAt: string
  runtimeTarget: LocalWorkspace['runtimeTarget']
}

function defaultWorkspaceIdentity(basePath: string): WorkspaceIdentity {
  const now = new Date().toISOString()
  return {
    id: basename(basePath) || 'thredos-workspace',
    label: basename(basePath) || 'thredOS Workspace',
    createdAt: now,
    lastOpenedAt: now,
    runtimeTarget: 'desktop',
  }
}

function parseWorkspaceIdentity(rawSource: string): Partial<WorkspaceIdentity> {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawSource)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid .threados/state/local-workspace.json: ${message}`)
  }

  const result = WorkspaceIdentityCompatibilitySchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`Invalid .threados/state/local-workspace.json: ${result.error.issues.map(issue => issue.message).join(', ')}`)
  }
  return result.data
}

async function resolveWorkspace(
  basePath: string,
  identity: WorkspaceIdentity,
  config: WorkspaceConfig,
): Promise<LocalWorkspace> {
  const runtimeDataRoot = await resolveRuntimeDataRoot({
    canonicalRoot: basePath,
    override: config.runtime_data_root,
  })
  const canonicalProjectRoot = await canonicalizeProspectivePath(basePath)
  const paths = resolveWorkspaceRuntimePaths(runtimeDataRoot, identity.id, canonicalProjectRoot)
  const exclusions = await buildExclusionPolicy({
    canonicalRoot: basePath,
    config,
    alwaysExcludedRoots: [runtimeDataRoot],
  })
  return {
    ...identity,
    basePath,
    runtimeDataRoot: paths.runtimeDataRoot,
    runtimeNamespace: paths.workspaceNamespace,
    snapshotRoot: paths.snapshotsRoot,
    surfaceWorkspaceRoot: paths.workspacesRoot,
    exclusionPolicyHash: exclusions.exclusionPolicyHash,
    workspaceConfigVersion: config.version,
    workspaceProvider: config.provider,
    dataResidency: 'local-only',
  }
}

export async function projectLocalWorkspace(
  basePath: string,
  workspace: Pick<LocalWorkspace, 'id' | 'label' | 'createdAt' | 'lastOpenedAt' | 'runtimeTarget'>,
  config: WorkspaceConfig,
): Promise<LocalWorkspace> {
  return await resolveWorkspace(basePath, workspace, config)
}

export function getLocalWorkspaceStatePath(basePath: string): string {
  return join(basePath, LOCAL_WORKSPACE_STATE_PATH)
}

export async function readLocalWorkspaceIdentity(basePath: string): Promise<WorkspaceIdentity> {
  let raw: Partial<WorkspaceIdentity>
  try {
    const fullPath = await resolveExistingPathWithinRoot(
      basePath,
      '.threados',
      'state',
      'local-workspace.json',
    )
    raw = parseWorkspaceIdentity(await readTextFileNoFollow(fullPath))
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    return defaultWorkspaceIdentity(basePath)
  }

  const fallback = defaultWorkspaceIdentity(basePath)
  return {
    id: raw.id ?? fallback.id,
    label: raw.label ?? fallback.label,
    createdAt: raw.createdAt ?? fallback.createdAt,
    lastOpenedAt: raw.lastOpenedAt ?? fallback.lastOpenedAt,
    runtimeTarget: raw.runtimeTarget ?? fallback.runtimeTarget,
  }
}

export async function readLocalWorkspace(basePath: string): Promise<LocalWorkspace> {
  const [config, identity] = await Promise.all([
    loadWorkspaceConfig(basePath),
    readLocalWorkspaceIdentity(basePath),
  ])
  return await resolveWorkspace(basePath, identity, config)
}

export async function writeLocalWorkspace(basePath: string, workspace: LocalWorkspace): Promise<void> {
  const stateDirectory = await resolvePathWithinRoot(basePath, '.threados', 'state')
  await mkdir(stateDirectory, { recursive: true })
  const verifiedStateDirectory = await resolveExistingPathWithinRoot(basePath, '.threados', 'state')
  const fullPath = join(verifiedStateDirectory, 'local-workspace.json')
  await writeFileAtomic(fullPath, `${JSON.stringify(workspace, null, 2)}\n`, { allowedRoot: basePath })
}

export async function ensureLocalWorkspace(basePath: string): Promise<LocalWorkspace> {
  const workspace = await readLocalWorkspace(basePath)
  const nextWorkspace: LocalWorkspace = {
    ...workspace,
    basePath,
    lastOpenedAt: new Date().toISOString(),
  }
  await writeLocalWorkspace(basePath, nextWorkspace)
  return nextWorkspace
}

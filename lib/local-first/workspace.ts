import { existsSync } from 'fs'
import { mkdir, readFile } from 'fs/promises'
import { basename, join } from 'path'
import { writeFileAtomic } from '@/lib/fs/atomic'
import type { LocalWorkspace } from './types'

const LOCAL_WORKSPACE_STATE_PATH = '.threados/state/local-workspace.json'

function defaultWorkspace(basePath: string): LocalWorkspace {
  const now = new Date().toISOString()
  return {
    id: basename(basePath) || 'thredos-workspace',
    label: basename(basePath) || 'thredOS Workspace',
    basePath,
    createdAt: now,
    lastOpenedAt: now,
    runtimeTarget: 'desktop',
    dataResidency: 'local-only',
  }
}

export function getLocalWorkspaceStatePath(basePath: string): string {
  return join(basePath, LOCAL_WORKSPACE_STATE_PATH)
}

export async function readLocalWorkspace(basePath: string): Promise<LocalWorkspace> {
  const fullPath = getLocalWorkspaceStatePath(basePath)
  if (!existsSync(fullPath)) {
    return defaultWorkspace(basePath)
  }

  const raw = JSON.parse(await readFile(fullPath, 'utf-8')) as Partial<LocalWorkspace>
  const fallback = defaultWorkspace(basePath)
  return {
    id: raw.id ?? fallback.id,
    label: raw.label ?? fallback.label,
    basePath,
    createdAt: raw.createdAt ?? fallback.createdAt,
    lastOpenedAt: raw.lastOpenedAt ?? fallback.lastOpenedAt,
    runtimeTarget: raw.runtimeTarget ?? fallback.runtimeTarget,
    dataResidency: 'local-only',
  }
}

export async function writeLocalWorkspace(basePath: string, workspace: LocalWorkspace): Promise<void> {
  const fullPath = getLocalWorkspaceStatePath(basePath)
  await mkdir(join(basePath, '.threados/state'), { recursive: true })
  await writeFileAtomic(fullPath, `${JSON.stringify(workspace, null, 2)}\n`)
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

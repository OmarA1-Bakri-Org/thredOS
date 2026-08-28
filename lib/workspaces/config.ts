import { mkdir } from 'fs/promises'
import { join } from 'path'
import YAML from 'yaml'
import { writeFileAtomic } from '@/lib/fs/atomic'
import { readTextFileNoFollow } from '@/lib/security/safe-io'
import { resolveExistingPathWithinRoot } from '@/lib/security/safe-path'
import {
  createDefaultWorkspaceConfig,
  WorkspaceConfigSchema,
  type WorkspaceConfig,
} from './config-schema'

const WORKSPACE_CONFIG_PATH = '.threados/workspace.yaml'

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

export class WorkspaceConfigError extends Error {
  constructor(public readonly code: 'WORKSPACE_CONFIG_INVALID', message: string) {
    super(message)
    this.name = 'WorkspaceConfigError'
  }
}

export function getWorkspaceConfigPath(basePath: string): string {
  return join(basePath, WORKSPACE_CONFIG_PATH)
}

export async function loadWorkspaceConfig(basePath: string): Promise<WorkspaceConfig> {
  let source: string
  try {
    const path = await resolveExistingPathWithinRoot(basePath, '.threados', 'workspace.yaml')
    source = await readTextFileNoFollow(path)
  } catch (error) {
    if (isMissing(error)) return createDefaultWorkspaceConfig()
    throw error
  }

  try {
    return WorkspaceConfigSchema.parse(YAML.parse(source) ?? {})
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new WorkspaceConfigError('WORKSPACE_CONFIG_INVALID', `Invalid .threados/workspace.yaml: ${message}`)
  }
}

export async function writeWorkspaceConfig(basePath: string, config: WorkspaceConfig): Promise<void> {
  const parsed = WorkspaceConfigSchema.parse(config)
  await mkdir(join(basePath, '.threados'), { recursive: true })
  await writeFileAtomic(
    getWorkspaceConfigPath(basePath),
    YAML.stringify(parsed),
    { allowedRoot: basePath },
  )
}

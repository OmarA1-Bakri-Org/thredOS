import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import YAML from 'yaml'
import { loadWorkspaceConfig, writeWorkspaceConfig } from './config'
import { createDefaultWorkspaceConfig, WorkspaceConfigSchema } from './config-schema'

const roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'threados-workspace-config-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('workspace configuration', () => {
  test('missing configuration produces safe canonical defaults without Git', async () => {
    const config = await loadWorkspaceConfig(await tempRoot())

    expect(config).toEqual(createDefaultWorkspaceConfig())
    expect(config.provider).toBe('auto')
    expect(config.snapshot.include_untracked).toBe(true)
    expect(config.snapshot.exclusions).toContain('.git/')
    expect(config.snapshot.exclusions).toContain('.threados/')
    expect(config.workspace.retention).toBe('retain_until_applied')
  })

  test('loads the locked workspace.yaml shape in a non-Git directory', async () => {
    const root = await tempRoot()
    await mkdir(join(root, '.threados'), { recursive: true })
    await writeFile(join(root, '.threados', 'workspace.yaml'), YAML.stringify({
      version: 1,
      provider: 'copy',
      runtime_data_root: join(root, '..', 'external-runtime'),
      snapshot: {
        exclusions: ['generated/'],
        include_untracked: false,
        max_source_retries: 2,
      },
      workspace: {
        retention: 'retain_always',
        max_active: 2,
        max_bytes_each: 100,
        max_total_retained_bytes: 500,
        max_files: 20,
      },
      bootstrap: ['bun install --frozen-lockfile'],
      validate: ['bun test'],
    }))

    const config = await loadWorkspaceConfig(root)
    expect(config.provider).toBe('copy')
    expect(config.snapshot.exclusions).toEqual(['generated/'])
    expect(config.snapshot.include_untracked).toBe(false)
    expect(config.workspace.max_active).toBe(2)
    expect(config.bootstrap).toEqual(['bun install --frozen-lockfile'])
  })

  test('rejects retained-byte quotas smaller than one workspace', () => {
    expect(WorkspaceConfigSchema.safeParse({
      workspace: {
        max_bytes_each: 101,
        max_total_retained_bytes: 100,
      },
    }).success).toBe(false)
  })

  test('writes validated YAML atomically and reads it back', async () => {
    const root = await tempRoot()
    const config = createDefaultWorkspaceConfig()
    config.provider = 'copy'
    config.snapshot.exclusions.push('tmp/')

    await writeWorkspaceConfig(root, config)
    expect(await loadWorkspaceConfig(root)).toEqual(config)
  })

  test('does not read workspace configuration through an escaping symlink', async () => {
    const root = await tempRoot()
    const outside = await tempRoot()
    await mkdir(join(root, '.threados'), { recursive: true })
    const outsideConfig = join(outside, 'workspace.yaml')
    await writeFile(outsideConfig, 'version: 1\n')
    await symlink(outsideConfig, join(root, '.threados', 'workspace.yaml'), 'file')

    await expect(loadWorkspaceConfig(root)).rejects.toThrow('allowed root')
  })
})

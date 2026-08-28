import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { createDefaultWorkspaceConfig } from './config-schema'
import { buildExclusionPolicy } from './exclusions'

const roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'threados-exclusions-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('workspace exclusion policy', () => {
  test('supports Gitignore negation and directory rules', async () => {
    const root = await tempRoot()
    await writeFile(join(root, '.threadosignore'), '*.log\n!keep.log\ncache/\n')
    const policy = await buildExclusionPolicy({
      canonicalRoot: root,
      config: createDefaultWorkspaceConfig(),
    })

    expect(policy.shouldExclude('debug.log')).toBe(true)
    expect(policy.shouldExclude('keep.log')).toBe(false)
    expect(policy.shouldExclude('cache', true)).toBe(true)
    expect(policy.shouldExclude('cache/value.txt')).toBe(true)
  })

  test('.git and .threados remain excluded despite later negations', async () => {
    const root = await tempRoot()
    await writeFile(join(root, '.threadosignore'), '!.git/**\n!.threados/**\n')
    const policy = await buildExclusionPolicy({
      canonicalRoot: root,
      config: createDefaultWorkspaceConfig(),
    })

    expect(policy.shouldExclude('.git/config')).toBe(true)
    expect(policy.shouldExclude('.GIT/config')).toBe(true)
    expect(policy.shouldExclude('.threados/sequence.yaml')).toBe(true)
  })

  test('sibling runtime roots are hard exclusions and cannot be negated', async () => {
    const root = await tempRoot()
    const sibling = join(root, 'runtime-sibling')
    await mkdir(sibling)
    await writeFile(join(root, '.threadosignore'), '!runtime-sibling/**\n')
    const policy = await buildExclusionPolicy({
      canonicalRoot: root,
      config: createDefaultWorkspaceConfig(),
      alwaysExcludedRoots: [sibling],
    })

    expect(policy.shouldExclude('runtime-sibling/tree/file.ts')).toBe(true)
  })

  test('required includes do not override an explicit workspace.yaml exclusion', async () => {
    const root = await tempRoot()
    const config = createDefaultWorkspaceConfig()
    config.snapshot.exclusions.push('bun.lock')
    const policy = await buildExclusionPolicy({
      canonicalRoot: root,
      config,
      requiredIncludes: ['bun.lock'],
    })

    expect(policy.shouldExclude('bun.lock')).toBe(true)
  })

  test('required includes can restore a built-in default exclusion when the user did not explicitly exclude it', async () => {
    const root = await tempRoot()
    const policy = await buildExclusionPolicy({
      canonicalRoot: root,
      config: createDefaultWorkspaceConfig(),
      requiredIncludes: ['node_modules/kept.txt'],
    })

    expect(policy.shouldExclude('node_modules/kept.txt')).toBe(false)
    expect(policy.shouldExclude('node_modules/other.txt')).toBe(true)
  })

  test('active required includes reopen ancestor directories so a walker can reach nested files', async () => {
    const root = await tempRoot()
    const policy = await buildExclusionPolicy({
      canonicalRoot: root,
      config: createDefaultWorkspaceConfig(),
      requiredIncludes: ['node_modules/pkg/kept.txt'],
    })

    expect(policy.shouldExclude('node_modules', true)).toBe(false)
    expect(policy.shouldExclude('node_modules/pkg', true)).toBe(false)
    expect(policy.shouldExclude('node_modules/pkg/kept.txt')).toBe(false)
    expect(policy.shouldExclude('node_modules/pkg/other.txt')).toBe(true)
  })

  test('explicit user exclusions still win for required-include ancestor traversal', async () => {
    const root = await tempRoot()
    const config = createDefaultWorkspaceConfig()
    config.snapshot.exclusions.push('node_modules/pkg/')
    const policy = await buildExclusionPolicy({
      canonicalRoot: root,
      config,
      requiredIncludes: ['node_modules/pkg/kept.txt'],
    })

    expect(policy.shouldExclude('node_modules', true)).toBe(true)
    expect(policy.shouldExclude('node_modules/pkg', true)).toBe(true)
    expect(policy.shouldExclude('node_modules/pkg/kept.txt')).toBe(true)
  })

  test('.threadosignore ordering remains truthful when a later negation restores a path', async () => {
    const root = await tempRoot()
    await writeFile(join(root, '.threadosignore'), 'bun.lock\n!bun.lock\n')
    const policy = await buildExclusionPolicy({
      canonicalRoot: root,
      config: createDefaultWorkspaceConfig(),
      requiredIncludes: ['bun.lock'],
    })

    expect(policy.shouldExclude('bun.lock')).toBe(false)
  })

  test('.threadosignore ordering remains truthful when a later explicit exclusion wins', async () => {
    const root = await tempRoot()
    await writeFile(join(root, '.threadosignore'), 'bun.lock\n!bun.lock\nbun.lock\n')
    const policy = await buildExclusionPolicy({
      canonicalRoot: root,
      config: createDefaultWorkspaceConfig(),
      requiredIncludes: ['bun.lock'],
    })

    expect(policy.shouldExclude('bun.lock')).toBe(true)
  })

  test('hashes the ordered policy deterministically and rejects traversal', async () => {
    const root = await tempRoot()
    const config = createDefaultWorkspaceConfig()
    const first = await buildExclusionPolicy({ canonicalRoot: root, config })
    const second = await buildExclusionPolicy({ canonicalRoot: root, config })
    expect(first.exclusionPolicyHash).toBe(second.exclusionPolicyHash)

    config.snapshot.exclusions.push('generated/')
    const changed = await buildExclusionPolicy({ canonicalRoot: root, config })
    expect(changed.exclusionPolicyHash).not.toBe(first.exclusionPolicyHash)
    expect(() => first.shouldExclude('../escape')).toThrow('contained relative path')
    expect(() => first.shouldExclude('nested//file')).toThrow('contained relative path')
  })

  test('does not read .threadosignore through an escaping symlink', async () => {
    const root = await tempRoot()
    const outside = await tempRoot()
    const outsideIgnore = join(outside, '.threadosignore')
    await writeFile(outsideIgnore, '!secrets/**\n')
    await symlink(outsideIgnore, join(root, '.threadosignore'), 'file')

    await expect(buildExclusionPolicy({
      canonicalRoot: root,
      config: createDefaultWorkspaceConfig(),
    })).rejects.toThrow('allowed root')
  })
})

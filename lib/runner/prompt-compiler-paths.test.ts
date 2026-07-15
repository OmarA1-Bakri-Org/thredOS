import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { compilePrompt } from './prompt-compiler'
import type { Sequence, Step } from '../sequence/schema'

function makeStep(id: string, overrides: Partial<Step> = {}): Step {
  return {
    id,
    name: id,
    type: 'base',
    model: 'test',
    prompt_file: `.threados/prompts/${id}.md`,
    depends_on: [],
    status: 'READY',
    ...overrides,
  }
}

describe('prompt compiler artifact containment', () => {
  let testRoot: string
  let basePath: string
  let runsDir: string

  beforeEach(async () => {
    testRoot = await mkdtemp(join(tmpdir(), 'thredos-prompt-artifacts-'))
    basePath = join(testRoot, 'project')
    runsDir = join(basePath, '.threados', 'runs')
    await mkdir(runsDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true })
  })

  async function compileFor(current: Step, dependency: Step): Promise<string> {
    const sequence: Sequence = { version: '1.0', name: 'security', steps: [dependency, current], gates: [] }
    return await compilePrompt({
      stepId: current.id,
      step: current,
      rawPrompt: 'Do safe work.',
      sequence,
      basePath,
    })
  }

  test('rejects a traversal-capable dependency identifier before artifact scanning', async () => {
    const unsafeDependencyId = '../../../outside-dep'
    const outsideArtifact = join(basePath, 'outside-dep')
    await mkdir(outsideArtifact, { recursive: true })
    await writeFile(join(outsideArtifact, 'stdout.log'), 'TRAVERSAL_SECRET')
    await mkdir(join(runsDir, 'run-a'), { recursive: true })
    const dependency = makeStep(unsafeDependencyId, { status: 'DONE' })
    const current = makeStep('current', { depends_on: [unsafeDependencyId] })

    await expect(compileFor(current, dependency)).rejects.toThrow('dependency')
  })

  test('does not read artifacts through an escaping run-directory junction', async () => {
    const outsideRun = join(testRoot, 'outside-run')
    await mkdir(join(outsideRun, 'dep-safe'), { recursive: true })
    await writeFile(join(outsideRun, 'dep-safe', 'stdout.log'), 'RUN_LINK_SECRET')
    await symlink(outsideRun, join(runsDir, 'run-link'), process.platform === 'win32' ? 'junction' : 'dir')
    const dependency = makeStep('dep-safe', { status: 'DONE' })
    const current = makeStep('current', { depends_on: ['dep-safe'] })

    expect(await compileFor(current, dependency)).not.toContain('RUN_LINK_SECRET')
  })

  test('does not read stdout through an escaping final-file symlink', async () => {
    const artifactDir = join(runsDir, 'run-safe', 'dep-safe')
    await mkdir(artifactDir, { recursive: true })
    const outsideStdout = join(testRoot, 'outside-stdout.log')
    await writeFile(outsideStdout, 'STDOUT_LINK_SECRET')
    await symlink(outsideStdout, join(artifactDir, 'stdout.log'), 'file')
    const dependency = makeStep('dep-safe', { status: 'DONE' })
    const current = makeStep('current', { depends_on: ['dep-safe'] })

    expect(await compileFor(current, dependency)).not.toContain('STDOUT_LINK_SECRET')
  })

  test('does not read status through an escaping final-file symlink', async () => {
    const artifactDir = join(runsDir, 'run-safe', 'dep-safe')
    await mkdir(artifactDir, { recursive: true })
    await writeFile(join(artifactDir, 'stdout.log'), 'safe output')
    const outsideStatus = join(testRoot, 'outside-status.json')
    await writeFile(outsideStatus, JSON.stringify({ duration: 999000 }))
    await symlink(outsideStatus, join(artifactDir, 'status.json'), 'file')
    const dependency = makeStep('dep-safe', { status: 'DONE' })
    const current = makeStep('current', { depends_on: ['dep-safe'] })

    expect(await compileFor(current, dependency)).not.toContain('(999s)')
  })
})

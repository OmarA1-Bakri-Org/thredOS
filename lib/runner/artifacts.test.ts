import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { createTempDir, cleanTempDir } from '../../test/helpers/setup'
import type { RunResult } from './wrapper'

async function importActualArtifacts() {
  return import(new URL(`./artifacts.ts?cacheBust=${Date.now()}-${Math.random()}`, import.meta.url).href) as Promise<typeof import('./artifacts')>
}

describe('artifacts', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await createTempDir()
  })

  afterEach(async () => {
    await cleanTempDir(tmpDir)
  })

  test('createRunDirectory creates nested dirs', async () => {
    const { createRunDirectory } = await importActualArtifacts()
    const dir = await createRunDirectory(tmpDir, 'run-1', 'step-1')
    expect(dir).toBe(join(tmpDir, '.threados', 'runs', 'run-1', 'step-1'))
    const { access } = await import('fs/promises')
    await access(dir)
  })

  test('writeStdout/writeStderr write files', async () => {
    const { createRunDirectory, writeStdout, writeStderr } = await importActualArtifacts()
    const dir = await createRunDirectory(tmpDir, 'run-1', 'step-1')
    await writeStdout(dir, 'out content')
    await writeStderr(dir, 'err content')
    expect(await readFile(join(dir, 'stdout.log'), 'utf-8')).toBe('out content')
    expect(await readFile(join(dir, 'stderr.log'), 'utf-8')).toBe('err content')
  })

  test('writeStatus writes JSON', async () => {
    const { createRunDirectory, writeStatus } = await importActualArtifacts()
    const dir = await createRunDirectory(tmpDir, 'run-1', 'step-1')
    const status = {
      stepId: 'step-1',
      runId: 'run-1',
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-01-01T00:00:01.000Z',
      duration: 1000,
      exitCode: 0,
      status: 'SUCCESS' as const,
    }
    await writeStatus(dir, status)
    const content = JSON.parse(await readFile(join(dir, 'status.json'), 'utf-8'))
    expect(content.status).toBe('SUCCESS')
    expect(content.exitCode).toBe(0)
  })

  test('saveRunArtifacts creates full structure', async () => {
    const { saveRunArtifacts } = await importActualArtifacts()
    const now = new Date()
    const result: RunResult = {
      stepId: 'step-1',
      runId: 'run-1',
      exitCode: 0,
      status: 'SUCCESS',
      duration: 100,
      stdout: 'hello',
      stderr: '',
      startTime: now,
      endTime: now,
    }
    const artifactPath = await saveRunArtifacts(tmpDir, result)
    expect(artifactPath).toBe(join(tmpDir, '.threados', 'runs', 'run-1', 'step-1'))

    const stdout = await readFile(join(artifactPath, 'stdout.log'), 'utf-8')
    expect(stdout).toBe('hello')

    const statusJson = JSON.parse(await readFile(join(artifactPath, 'status.json'), 'utf-8'))
    expect(statusJson.status).toBe('SUCCESS')
  })

  test('saveRunArtifacts writes canonical surface manifests when surface metadata is supplied', async () => {
    const { saveRunArtifacts } = await importActualArtifacts()
    const now = new Date('2026-04-10T12:00:00.000Z')
    const result: RunResult = {
      stepId: 'step-1',
      runId: 'run-2',
      exitCode: 0,
      status: 'SUCCESS',
      duration: 250,
      stdout: 'surface-output',
      stderr: '',
      startTime: now,
      endTime: now,
    }

    await saveRunArtifacts(tmpDir, result, {
      surfaceId: 'thread-step-1',
      compiledPrompt: '# compiled',
      inputManifest: {
        stepId: 'step-1',
        runId: 'run-2',
        surfaceId: 'thread-step-1',
        promptRef: '.threados/prompts/step-1.md',
        dependsOn: [],
        inputContractRef: 'contracts/input.json',
        createdAt: now.toISOString(),
      },
      outputContractRef: 'contracts/output.json',
      completionContract: 'contracts/completion.json',
    })

    const surfaceDir = join(tmpDir, '.threados', 'runs', 'run-2', 'surfaces', 'thread-step-1')
    expect(await readFile(join(surfaceDir, 'compiled-prompt.md'), 'utf-8')).toBe('# compiled')
    const inputManifest = JSON.parse(await readFile(join(surfaceDir, 'input.manifest.json'), 'utf-8'))
    expect(inputManifest.inputContractRef).toBe('contracts/input.json')
    const artifactManifest = JSON.parse(await readFile(join(surfaceDir, 'artifact.manifest.json'), 'utf-8'))
    expect(artifactManifest.outputContractRef).toBe('contracts/output.json')
    expect(artifactManifest.completionContract).toBe('contracts/completion.json')
    expect(await readFile(join(surfaceDir, 'logs', 'stdout.log'), 'utf-8')).toBe('surface-output')
  })

  test('getRuntimeEventLogPath resolves under the run artifact directory', async () => {
    const { getRuntimeEventLogPath } = await importActualArtifacts()
    expect(getRuntimeEventLogPath(tmpDir, 'run-2', 'step-9')).toBe(
      join(tmpDir, '.threados', 'runs', 'run-2', 'step-9', 'events.jsonl'),
    )
  })
})

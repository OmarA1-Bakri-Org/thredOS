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
    expect(dir).toBe(join(tmpDir, '.threados/runs/run-1/step-1'))
    // Should not throw on access
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

  test('getRuntimeEventLogPath resolves under the run artifact directory', async () => {
    const { getRuntimeEventLogPath } = await importActualArtifacts()
    expect(getRuntimeEventLogPath(tmpDir, 'run-2', 'step-9')).toBe(
      join(tmpDir, '.threados', 'runs', 'run-2', 'step-9', 'events.jsonl'),
    )
  })
})

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { reconcileState, reconcileStateWithDeps } from './reconciler'
import { writeSequence, readSequence } from '../sequence/parser'
import { mkdir, rm, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { readMprocsMap, writeMprocsMap } from '../mprocs/state'

interface MprocsCommand {
  c: 'select-proc'
  index: number
}

interface MprocsResult {
  success: boolean
  exitCode: number
}

let testDir: string

beforeEach(async () => {
  testDir = join(tmpdir(), `reconciler-test-${Date.now()}`)
  await mkdir(join(testDir, '.threados', 'state'), { recursive: true })
})

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true })
})

function makeSequenceWithRunningSteps() {
  return {
    version: '1.0' as const,
    name: 'test',
    steps: [
      { id: 's1', name: 'S1', type: 'base' as const, model: 'claude-code' as const, prompt_file: 'p.md', depends_on: [], status: 'RUNNING' as const },
      { id: 's2', name: 'S2', type: 'base' as const, model: 'claude-code' as const, prompt_file: 'p.md', depends_on: [], status: 'RUNNING' as const },
      { id: 's3', name: 'S3', type: 'base' as const, model: 'claude-code' as const, prompt_file: 'p.md', depends_on: [], status: 'DONE' as const },
    ],
    gates: [],
  }
}

describe('reconcileState', () => {
  test('no changes when no RUNNING steps', async () => {
    await writeSequence(testDir, {
      version: '1.0',
      name: 'test',
      steps: [
        { id: 's1', name: 'S1', type: 'base', model: 'claude-code', prompt_file: 'p.md', depends_on: [], status: 'READY' },
      ],
      gates: [],
    })

    const result = await reconcileState(testDir)
    expect(result.checked).toBe(0)
    expect(result.changes).toHaveLength(0)
  })

  test('leaves generic RUNNING steps untouched when they have no tracked mprocs mapping', async () => {
    await writeSequence(testDir, {
      version: '1.0',
      name: 'test',
      steps: [
        { id: 's1', name: 'S1', type: 'base', model: 'claude-code', prompt_file: 'p.md', depends_on: [], status: 'RUNNING' },
      ],
      gates: [],
    })

    const auditLog = mock(async () => {})
    const result = await reconcileStateWithDeps(testDir, {
      readSequence,
      writeSequence,
      readMprocsMap: async () => ({}),
      removeStepProcess: mock(async () => {}),
      logAudit: auditLog,
      createClient: () => ({
        isServerRunning: async () => true,
        sendCommand: async (_command: MprocsCommand): Promise<MprocsResult> => ({ success: true, exitCode: 0 }),
      }),
    })

    expect(result.checked).toBe(1)
    expect(result.changes).toEqual([])
    expect(auditLog).not.toHaveBeenCalled()

    const seq = await readSequence(testDir)
    expect(seq.steps[0].status).toBe('RUNNING')
  })

  test('marks tracked RUNNING steps as FAILED when the mprocs server is unavailable and removes stale mappings', async () => {
    await writeSequence(testDir, makeSequenceWithRunningSteps())
    await writeMprocsMap(testDir, { s1: 0, s2: 1 })

    const removeStepProcess = mock(async (basePath: string, stepId: string) => {
      const current = JSON.parse(await readFile(join(basePath, '.threados', 'state', 'mprocs-map.json'), 'utf-8')) as Record<string, number>
      delete current[stepId]
      await writeMprocsMap(basePath, current)
    })

    const result = await reconcileStateWithDeps(testDir, {
      readSequence,
      writeSequence,
      readMprocsMap,
      removeStepProcess,
      logAudit: mock(async () => {}),
      createClient: () => ({
        isServerRunning: async () => false,
        sendCommand: async (_command: MprocsCommand): Promise<MprocsResult> => ({ success: false, exitCode: 1 }),
      }),
    })

    expect(result.checked).toBe(2)
    expect(result.changes).toHaveLength(2)
    expect(result.changes[0]?.reason).toBe('mprocs server not available, tracked process orphaned')
    expect(removeStepProcess).toHaveBeenCalledTimes(2)

    const seq = await readSequence(testDir)
    expect(seq.steps[0].status).toBe('FAILED')
    expect(seq.steps[1].status).toBe('FAILED')
    expect(seq.steps[2].status).toBe('DONE')

    const mprocsMap = JSON.parse(await readFile(join(testDir, '.threados', 'state', 'mprocs-map.json'), 'utf-8')) as Record<string, number>
    expect(mprocsMap).toEqual({})
  })

  test('keeps RUNNING steps when their tracked process is still selectable', async () => {
    await writeSequence(testDir, {
      version: '1.0',
      name: 'test',
      steps: [
        { id: 's1', name: 'S1', type: 'base', model: 'claude-code', prompt_file: 'p.md', depends_on: [], status: 'RUNNING' },
      ],
      gates: [],
    })

    const sendCommand = mock(async (command: MprocsCommand): Promise<MprocsResult> => {
      expect(command).toEqual({ c: 'select-proc', index: 7 })
      return { success: true, exitCode: 0 }
    })

    const result = await reconcileStateWithDeps(testDir, {
      readSequence,
      writeSequence,
      readMprocsMap: async () => ({ s1: 7 }),
      removeStepProcess: mock(async () => {}),
      logAudit: mock(async () => {}),
      createClient: () => ({
        isServerRunning: async () => true,
        sendCommand,
      }),
    })

    expect(result.checked).toBe(1)
    expect(result.changes).toEqual([])

    const seq = await readSequence(testDir)
    expect(seq.steps[0].status).toBe('RUNNING')
  })

  test('marks RUNNING steps as FAILED when their tracked process index is missing on a live server', async () => {
    await writeSequence(testDir, {
      version: '1.0',
      name: 'test',
      steps: [
        { id: 's1', name: 'S1', type: 'base', model: 'claude-code', prompt_file: 'p.md', depends_on: [], status: 'RUNNING' },
      ],
      gates: [],
    })

    const result = await reconcileStateWithDeps(testDir, {
      readSequence,
      writeSequence,
      readMprocsMap: async () => ({ s1: 3 }),
      removeStepProcess: mock(async () => {}),
      logAudit: mock(async () => {}),
      createClient: () => ({
        isServerRunning: async () => true,
        sendCommand: async (_command: MprocsCommand): Promise<MprocsResult> => ({ success: false, exitCode: 1 }),
      }),
    })

    expect(result.changes).toEqual([
      expect.objectContaining({
        stepId: 's1',
        reason: 'tracked mprocs process missing (index 3)',
      }),
    ])

    const seq = await readSequence(testDir)
    expect(seq.steps[0].status).toBe('FAILED')
  })

  test('handles missing sequence gracefully', async () => {
    const result = await reconcileState(join(testDir, 'nonexistent'))
    expect(result.checked).toBe(0)
    expect(result.changes).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
  })
})

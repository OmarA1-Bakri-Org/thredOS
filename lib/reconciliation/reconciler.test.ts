import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { reconcileState } from './reconciler'
import { writeSequence, readSequence } from '../sequence/parser'
import { mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

let testDir: string

beforeEach(async () => {
  testDir = join(tmpdir(), `reconciler-test-${Date.now()}`)
  await mkdir(join(testDir, '.threados'), { recursive: true })
})

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true })
})

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

  test('marks orphaned RUNNING steps as FAILED when mprocs unavailable', async () => {
    await writeSequence(testDir, {
      version: '1.0',
      name: 'test',
      steps: [
        { id: 's1', name: 'S1', type: 'base', model: 'claude-code', prompt_file: 'p.md', depends_on: [], status: 'RUNNING' },
        { id: 's2', name: 'S2', type: 'base', model: 'claude-code', prompt_file: 'p.md', depends_on: [], status: 'RUNNING' },
        { id: 's3', name: 'S3', type: 'base', model: 'claude-code', prompt_file: 'p.md', depends_on: [], status: 'DONE' },
      ],
      gates: [],
    })

    const result = await reconcileState(testDir)
    expect(result.checked).toBe(2)
    expect(result.changes).toHaveLength(2)
    expect(result.changes[0].stepId).toBe('s1')
    expect(result.changes[0].to).toBe('FAILED')
    expect(result.changes[1].stepId).toBe('s2')

    // Verify persisted
    const seq = await readSequence(testDir)
    expect(seq.steps[0].status).toBe('FAILED')
    expect(seq.steps[1].status).toBe('FAILED')
    expect(seq.steps[2].status).toBe('DONE')
  })

  test('handles missing sequence gracefully', async () => {
    const result = await reconcileState(join(testDir, 'nonexistent'))
    expect(result.checked).toBe(0)
    expect(result.changes).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
  })
})

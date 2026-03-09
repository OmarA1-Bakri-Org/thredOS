import { beforeEach, afterEach, describe, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { createTempDir, cleanTempDir } from '../../test/helpers/setup'

async function importRuntimeEventLog() {
  return import(new URL(`./runtime-event-log.ts?cacheBust=${Date.now()}-${Math.random()}`, import.meta.url).href) as Promise<typeof import('./runtime-event-log')>
}

describe('runtime event log', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await createTempDir()
  })

  afterEach(async () => {
    await cleanTempDir(tmpDir)
  })

  test('parses valid spawn-child and merge-into events from JSONL', async () => {
    const { getRuntimeEventLogPath, readRuntimeEventLog } = await importRuntimeEventLog()
    const logPath = getRuntimeEventLogPath(tmpDir, 'run-1', 'step-1')
    await mkdir(join(tmpDir, '.threados', 'runs', 'run-1', 'step-1'), { recursive: true })
    await writeFile(
      logPath,
      [
        JSON.stringify({
          eventType: 'spawn-child',
          createdAt: '2026-03-09T12:00:00.000Z',
          childStepId: 'worker-a',
          childLabel: 'Worker A',
          spawnKind: 'orchestrator',
        }),
        JSON.stringify({
          eventType: 'merge-into',
          createdAt: '2026-03-09T12:00:01.000Z',
          destinationStepId: 'synthesis',
          sourceStepIds: ['worker-a', 'worker-b'],
          mergeKind: 'block',
          summary: 'merge workers',
        }),
      ].join('\n'),
      'utf-8',
    )

    const result = await readRuntimeEventLog(tmpDir, 'run-1', 'step-1')
    expect(result.invalidLines).toBe(0)
    expect(result.events).toEqual([
      expect.objectContaining({
        eventType: 'spawn-child',
        childStepId: 'worker-a',
        spawnKind: 'orchestrator',
      }),
      expect.objectContaining({
        eventType: 'merge-into',
        destinationStepId: 'synthesis',
        sourceStepIds: ['worker-a', 'worker-b'],
        mergeKind: 'block',
      }),
    ])
  })

  test('ignores blank lines and counts malformed lines without throwing', async () => {
    const { getRuntimeEventLogPath, readRuntimeEventLog } = await importRuntimeEventLog()
    const logPath = getRuntimeEventLogPath(tmpDir, 'run-2', 'step-2')
    await mkdir(join(tmpDir, '.threados', 'runs', 'run-2', 'step-2'), { recursive: true })
    await writeFile(
      logPath,
      [
        '',
        '{"eventType":"spawn-child","createdAt":"2026-03-09T12:00:00.000Z","childStepId":"worker-a","childLabel":"Worker A","spawnKind":"orchestrator"}',
        '{"eventType":"merge-into","createdAt":"2026-03-09T12:00:01.000Z","destinationStepId":"synth"}',
        'not-json',
        '',
      ].join('\n'),
      'utf-8',
    )

    const result = await readRuntimeEventLog(tmpDir, 'run-2', 'step-2')
    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toEqual(expect.objectContaining({ eventType: 'spawn-child' }))
    expect(result.invalidLines).toBe(2)
  })

  test('missing event log resolves to an empty result', async () => {
    const { readRuntimeEventLog } = await importRuntimeEventLog()
    const result = await readRuntimeEventLog(tmpDir, 'run-missing', 'step-missing')
    expect(result.events).toEqual([])
    expect(result.invalidLines).toBe(0)
  })
})

import { beforeEach, afterEach, describe, expect, test } from 'bun:test'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { createTempDir, cleanTempDir } from '../../test/helpers/setup'
import type { RuntimeDelegationEvent } from './runtime-event-log'

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

  test('appendRuntimeEventAtPath creates directories and writes event as JSONL', async () => {
    const { appendRuntimeEventAtPath } = await importRuntimeEventLog()
    const logPath = join(tmpDir, '.threados', 'runs', 'run-append', 'step-append', 'events.jsonl')

    const event: RuntimeDelegationEvent = {
      eventType: 'spawn-child',
      createdAt: '2026-03-09T14:00:00.000Z',
      childStepId: 'child-1',
      childLabel: 'Child One',
      spawnKind: 'fanout',
    }

    await appendRuntimeEventAtPath(logPath, event)

    const content = await readFile(logPath, 'utf-8')
    const parsed = JSON.parse(content.trim())
    expect(parsed).toEqual(event)
  })

  test('appendRuntimeEventAtPath appends multiple events as separate lines', async () => {
    const { appendRuntimeEventAtPath } = await importRuntimeEventLog()
    const logPath = join(tmpDir, '.threados', 'runs', 'run-multi', 'step-multi', 'events.jsonl')

    const event1: RuntimeDelegationEvent = {
      eventType: 'spawn-child',
      createdAt: '2026-03-09T14:00:00.000Z',
      childStepId: 'child-1',
      childLabel: 'Child One',
      spawnKind: 'orchestrator',
    }
    const event2: RuntimeDelegationEvent = {
      eventType: 'merge-into',
      createdAt: '2026-03-09T14:01:00.000Z',
      destinationStepId: 'synthesis',
      sourceStepIds: ['child-1'],
      mergeKind: 'single',
    }

    await appendRuntimeEventAtPath(logPath, event1)
    await appendRuntimeEventAtPath(logPath, event2)

    const content = await readFile(logPath, 'utf-8')
    const lines = content.trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0])).toEqual(event1)
    expect(JSON.parse(lines[1])).toEqual(event2)
  })

  test('appendRuntimeEvent writes to the correct path derived from basePath/runId/stepId', async () => {
    const { appendRuntimeEvent, getRuntimeEventLogPath, readRuntimeEventLog } = await importRuntimeEventLog()

    const event: RuntimeDelegationEvent = {
      eventType: 'spawn-child',
      createdAt: '2026-03-09T15:00:00.000Z',
      childStepId: 'worker-x',
      childLabel: 'Worker X',
      spawnKind: 'watchdog',
    }

    await appendRuntimeEvent(tmpDir, 'run-derived', 'step-derived', event)

    const expectedPath = getRuntimeEventLogPath(tmpDir, 'run-derived', 'step-derived')
    expect(existsSync(expectedPath)).toBe(true)

    const result = await readRuntimeEventLog(tmpDir, 'run-derived', 'step-derived')
    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toEqual(expect.objectContaining({
      eventType: 'spawn-child',
      childStepId: 'worker-x',
      spawnKind: 'watchdog',
    }))
    expect(result.invalidLines).toBe(0)
  })
})

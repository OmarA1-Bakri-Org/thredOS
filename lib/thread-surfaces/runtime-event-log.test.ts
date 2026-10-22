import { beforeEach, afterEach, describe, expect, test } from 'bun:test'
import { mkdir, readFile, symlink, writeFile } from 'fs/promises'
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

  test('producer identity and skill claims are never accepted as spawn authority', async () => {
    const { readRuntimeEventLogAtPath } = await importRuntimeEventLog()
    const logPath = join(tmpDir, 'events.ndjson')
    await writeFile(logPath, JSON.stringify({
      eventType: 'spawn-child', createdAt: '2026-03-09T12:00:00.000Z', childStepId: 'child', childLabel: 'Child',
      spawnKind: 'orchestrator', agent_registration: { registration_id: 'spoofed-agent' },
      agent: { metadata: { skills: [{ id: 'spawn' }] } },
    }))
    const result = await readRuntimeEventLogAtPath(logPath, tmpDir)
    expect(result.invalidLines).toBe(0)
    expect(result.events).toHaveLength(1)
    expect(result.events[0]).not.toHaveProperty('agent_registration')
    expect(result.events[0]).not.toHaveProperty('agent')
  })

  test('diagnostics omit private payloads from malformed and schema-invalid events', async () => {
    const { readRuntimeEventLogAtPath } = await importRuntimeEventLog()
    const logPath = join(tmpDir, 'private-events.ndjson')
    const secret = 'private-fixture-token-that-must-not-be-logged'
    await writeFile(logPath, [
      `{"token":"${secret}",`,
      JSON.stringify({ token: secret, eventType: 'unsupported-private-event' }),
    ].join('\n'))
    const diagnostics: string[] = []
    const originalWarn = console.warn
    console.warn = (...args: unknown[]) => { diagnostics.push(args.map(String).join(' ')) }
    try {
      expect(await readRuntimeEventLogAtPath(logPath, tmpDir)).toEqual({ events: [], invalidLines: 2 })
      expect(diagnostics).toHaveLength(2)
      expect(diagnostics.join('\n')).not.toContain(secret)
      expect(diagnostics.join('\n')).not.toContain('token')
      expect(diagnostics).toEqual([
        '[runtime-event-log] Malformed JSON at line 1',
        '[runtime-event-log] Invalid event at line 2',
      ])
    } finally {
      console.warn = originalWarn
    }
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

    await appendRuntimeEventAtPath(logPath, event, tmpDir)

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

    await appendRuntimeEventAtPath(logPath, event1, tmpDir)
    await appendRuntimeEventAtPath(logPath, event2, tmpDir)

    const content = await readFile(logPath, 'utf-8')
    const lines = content.trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0])).toEqual(event1)
    expect(JSON.parse(lines[1])).toEqual(event2)
  })

  test('reads an isolated workspace event channel from its explicit path', async () => {
    const { appendRuntimeEventAtPath, readRuntimeEventLogAtPath } = await importRuntimeEventLog()
    const logPath = join(tmpDir, 'workspace', '.threados-runtime', 'events.ndjson')
    const event: RuntimeDelegationEvent = {
      eventType: 'spawn-child',
      createdAt: '2026-03-09T14:00:00.000Z',
      childStepId: 'child-isolated',
      childLabel: 'Isolated Child',
      spawnKind: 'orchestrator',
    }

    await appendRuntimeEventAtPath(logPath, event, tmpDir)

    expect(await readRuntimeEventLogAtPath(logPath, join(tmpDir, 'workspace'))).toEqual({
      events: [event],
      invalidLines: 0,
    })
  })

  test.each(['parent', 'final file'] as const)('rejects reading an escaping %s symlink', async boundary => {
    const { readRuntimeEventLogAtPath } = await importRuntimeEventLog()
    const workspace = join(tmpDir, 'workspace-reader')
    const outside = join(tmpDir, 'outside-private')
    await mkdir(workspace, { recursive: true })
    await mkdir(outside, { recursive: true })
    const privateEvent = `${JSON.stringify({
      eventType: 'spawn-child', createdAt: '2026-03-09T14:00:00.000Z',
      childStepId: 'outside-private-child', childLabel: 'Private event', spawnKind: 'orchestrator',
    })}\n`
    await writeFile(join(outside, 'events.ndjson'), privateEvent)
    const channel = join(workspace, '.threados-runtime')
    if (boundary === 'parent') {
      await symlink(outside, channel, process.platform === 'win32' ? 'junction' : 'dir')
    } else {
      await mkdir(channel)
      await symlink(join(outside, 'events.ndjson'), join(channel, 'events.ndjson'), 'file')
    }

    await expect(readRuntimeEventLogAtPath(join(channel, 'events.ndjson'), workspace)).rejects.toThrow()
    expect(await readFile(join(outside, 'events.ndjson'), 'utf8')).toBe(privateEvent)
  })

  test('rejects an event log final-file symlink', async () => {
    const { appendRuntimeEventAtPath } = await importRuntimeEventLog()
    const eventRoot = join(tmpDir, 'workspace', '.threados-runtime')
    const outside = join(tmpDir, 'outside.ndjson')
    const logPath = join(eventRoot, 'events.ndjson')
    await mkdir(eventRoot, { recursive: true })
    await writeFile(outside, 'outside\n')
    await symlink(outside, logPath, 'file')

    await expect(appendRuntimeEventAtPath(logPath, {
      eventType: 'spawn-child',
      createdAt: '2026-03-09T14:00:00.000Z',
      childStepId: 'child-link',
      childLabel: 'Linked Child',
      spawnKind: 'orchestrator',
    }, join(tmpDir, 'workspace'))).rejects.toThrow()
    expect(await readFile(outside, 'utf8')).toBe('outside\n')
  })

  test('rejects an event log parent symlink or junction escape', async () => {
    const { appendRuntimeEventAtPath } = await importRuntimeEventLog()
    const workspace = join(tmpDir, 'workspace-parent-link')
    const outside = join(tmpDir, 'outside-events')
    await mkdir(workspace, { recursive: true })
    await mkdir(outside, { recursive: true })
    await symlink(outside, join(workspace, '.threados-runtime'), process.platform === 'win32' ? 'junction' : 'dir')
    const logPath = join(workspace, '.threados-runtime', 'events.ndjson')

    await expect(appendRuntimeEventAtPath(logPath, {
      eventType: 'spawn-child',
      createdAt: '2026-03-09T14:00:00.000Z',
      childStepId: 'child-parent-link',
      childLabel: 'Parent Linked Child',
      spawnKind: 'orchestrator',
    }, workspace)).rejects.toThrow()
    expect(existsSync(join(outside, 'events.ndjson'))).toBe(false)
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

  test('rejects a linked parent before creating any outside descendant directory', async () => {
    const { appendRuntimeEventAtPath } = await importRuntimeEventLog()
    const workspace = join(tmpDir, 'workspace-nested-link')
    const outside = join(tmpDir, 'outside-nested-events')
    await mkdir(workspace)
    await mkdir(outside)
    await symlink(outside, join(workspace, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')

    await expect(appendRuntimeEventAtPath(join(workspace, 'linked', 'new-directory', 'events.ndjson'), {
      eventType: 'spawn-child',
      createdAt: '2026-03-09T14:00:00.000Z',
      childStepId: 'child-nested-link',
      childLabel: 'Nested Linked Child',
      spawnKind: 'orchestrator',
    }, workspace)).rejects.toThrow()
    expect(existsSync(join(outside, 'new-directory'))).toBe(false)
  })
})

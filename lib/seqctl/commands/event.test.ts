import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { eventCommand } from './event'

const jsonOpts = { json: true, help: false, watch: false }

let tempDir = ''
let eventLogPath = ''
let originalEventLog = ''

describe('event command', () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'threados-event-command-'))
    eventLogPath = join(tempDir, 'events.jsonl')
    originalEventLog = process.env.THREADOS_EVENT_LOG ?? ''
    process.env.THREADOS_EVENT_LOG = eventLogPath
  })

  afterEach(async () => {
    if (originalEventLog) {
      process.env.THREADOS_EVENT_LOG = originalEventLog
    } else {
      delete process.env.THREADOS_EVENT_LOG
    }
    await rm(tempDir, { recursive: true, force: true })
  })

  test('spawn-child appends a validated event to THREADOS_EVENT_LOG', async () => {
    await eventCommand('spawn-child', [
      'worker-a',
      '--label', 'Worker A',
      '--kind', 'orchestrator',
      '--parent-step-id', 'root-step',
    ], jsonOpts)

    const lines = (await readFile(eventLogPath, 'utf-8')).trim().split(/\r?\n/)
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toEqual(expect.objectContaining({
      eventType: 'spawn-child',
      childStepId: 'worker-a',
      childLabel: 'Worker A',
      spawnKind: 'orchestrator',
      parentStepId: 'root-step',
    }))
  })

  test('merge-into appends a validated merge event to THREADOS_EVENT_LOG', async () => {
    await eventCommand('merge-into', [
      'synth-step',
      '--sources', 'worker-a,worker-b',
      '--kind', 'block',
      '--summary', 'Combine worker outputs',
    ], jsonOpts)

    const lines = (await readFile(eventLogPath, 'utf-8')).trim().split(/\r?\n/)
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toEqual(expect.objectContaining({
      eventType: 'merge-into',
      destinationStepId: 'synth-step',
      sourceStepIds: ['worker-a', 'worker-b'],
      mergeKind: 'block',
      summary: 'Combine worker outputs',
    }))
  })
})

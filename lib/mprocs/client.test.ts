import { beforeEach, describe, expect, test } from 'bun:test'
import { MprocsConnectionError } from '../errors'
import type { MprocsResult } from './client'

// @ts-expect-error Bun query imports are used here only to avoid test-time module cache pollution.
const { MprocsClient } = await import('./client.ts?mprocs-client-suite') as {
  MprocsClient: typeof import('./client').MprocsClient
}

const commandCalls: string[][] = []

class TestMprocsClient extends MprocsClient {
  private readonly responder: (args: string[]) => Promise<MprocsResult>

  constructor(responder: (args: string[]) => Promise<MprocsResult>) {
    super('127.0.0.1:4050', '/usr/bin/mprocs')
    this.responder = responder
  }

  protected override async executeCommand(args: string[]): Promise<MprocsResult> {
    commandCalls.push(args)
    return await this.responder(args)
  }
}

beforeEach(() => {
  commandCalls.length = 0
})

describe('MprocsClient', () => {
  test('serializes start-proc commands through --ctl YAML', async () => {
    const client = new TestMprocsClient(async () => ({ success: true, exitCode: 0 }))

    await client.sendCommand({ c: 'start-proc' })

    expect(commandCalls).toHaveLength(1)
    expect(commandCalls[0]?.[0]).toBe('--ctl')
    expect(commandCalls[0]?.[2]).toBe('--server')
    expect(commandCalls[0]?.[3]).toBe('127.0.0.1:4050')
    expect(commandCalls[0]?.[1]).toContain('c: start-proc')
  })

  test('serializes batch commands using cmds', async () => {
    const client = new TestMprocsClient(async () => ({ success: true, exitCode: 0 }))

    await client.sendCommand({
      c: 'batch',
      ops: [
        { c: 'select-proc', index: 0 },
        { c: 'restart-proc' },
      ],
    })

    expect(commandCalls[0]?.[1]).toContain('c: batch')
    expect(commandCalls[0]?.[1]).toContain('cmds:')
    expect(commandCalls[0]?.[1]).toContain('restart-proc')
  })

  test('startProcess with index sends select + start batch', async () => {
    const client = new TestMprocsClient(async () => ({ success: true, exitCode: 0 }))

    await client.startProcess(2)

    expect(commandCalls[0]?.[1]).toContain('select-proc')
    expect(commandCalls[0]?.[1]).toContain('start-proc')
    expect(commandCalls[0]?.[1]).toContain('index: 2')
  })

  test('stopProcess without index sends term-proc directly', async () => {
    const client = new TestMprocsClient(async () => ({ success: true, exitCode: 0 }))

    await client.stopProcess()

    expect(commandCalls[0]?.[1]).toContain('c: term-proc')
    expect(commandCalls[0]?.[1]).not.toContain('cmds:')
  })

  test('restartProcess with index sends select + restart batch', async () => {
    const client = new TestMprocsClient(async () => ({ success: true, exitCode: 0 }))

    await client.restartProcess(1)

    expect(commandCalls[0]?.[1]).toContain('select-proc')
    expect(commandCalls[0]?.[1]).toContain('restart-proc')
    expect(commandCalls[0]?.[1]).toContain('index: 1')
  })

  test('returns unsuccessful results without throwing on non-zero exits', async () => {
    const client = new TestMprocsClient(async () => ({ success: false, exitCode: 1, stderr: 'connection refused' }))

    const result = await client.sendCommand({ c: 'start-proc' })

    expect(result).toEqual({ success: false, exitCode: 1, stderr: 'connection refused' })
  })

  test('isServerRunning returns false when command fails', async () => {
    const client = new TestMprocsClient(async () => ({ success: false, exitCode: -1, stderr: 'spawn ENOENT' }))

    await expect(client.isServerRunning()).resolves.toBe(false)
  })

  test('waitForServer throws after timeout when the server never becomes available', async () => {
    const client = new TestMprocsClient(async () => ({ success: false, exitCode: -1, stderr: 'not ready' }))

    await expect(client.waitForServer(0)).rejects.toBeInstanceOf(MprocsConnectionError)
  })

  test('waitForServer resolves once the server starts responding', async () => {
    let attempts = 0
    const client = new TestMprocsClient(async () => {
      attempts += 1
      return attempts < 3
        ? { success: false, exitCode: 1, stderr: 'not ready' }
        : { success: true, exitCode: 0 }
    })

    await expect(client.waitForServer(500)).resolves.toBe(true)
    expect(attempts).toBe(3)
  })
})

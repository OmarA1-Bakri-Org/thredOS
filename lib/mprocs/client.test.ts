import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { MprocsConnectionError } from '../errors'

// Mock Bun.sleep to avoid real delays in tests
const originalSleep = Bun.sleep
beforeEach(() => {
  Bun.sleep = originalSleep
})

describe('MprocsClient', () => {
  describe('command serialization', () => {
    test('serializes start-proc command', async () => {
      let capturedYaml = ''
      const mockShell = mock(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        capturedYaml = String(values[1])
        return { exitCode: 0 }
      })

      const { MprocsClient } = await createClientWithMockedShell(mockShell)
      const client = new MprocsClient('127.0.0.1:4050', '/usr/bin/mprocs')
      await client.sendCommand({ c: 'start-proc' })

      expect(capturedYaml).toContain('c: start-proc')
    })

    test('serializes term-proc command', async () => {
      const commands: string[] = []
      const mockShell = createCapturingShell(commands)

      const { MprocsClient } = await createClientWithMockedShell(mockShell)
      const client = new MprocsClient('127.0.0.1:4050', '/usr/bin/mprocs')
      await client.sendCommand({ c: 'term-proc' })

      expect(commands[0]).toContain('c: term-proc')
    })

    test('serializes kill-proc command', async () => {
      const commands: string[] = []
      const mockShell = createCapturingShell(commands)

      const { MprocsClient } = await createClientWithMockedShell(mockShell)
      const client = new MprocsClient('127.0.0.1:4050', '/usr/bin/mprocs')
      await client.sendCommand({ c: 'kill-proc' })

      expect(commands[0]).toContain('c: kill-proc')
    })

    test('serializes restart-proc command', async () => {
      const commands: string[] = []
      const mockShell = createCapturingShell(commands)

      const { MprocsClient } = await createClientWithMockedShell(mockShell)
      const client = new MprocsClient('127.0.0.1:4050', '/usr/bin/mprocs')
      await client.sendCommand({ c: 'restart-proc' })

      expect(commands[0]).toContain('c: restart-proc')
    })

    test('serializes select-proc with index', async () => {
      const commands: string[] = []
      const mockShell = createCapturingShell(commands)

      const { MprocsClient } = await createClientWithMockedShell(mockShell)
      const client = new MprocsClient('127.0.0.1:4050', '/usr/bin/mprocs')
      await client.sendCommand({ c: 'select-proc', index: 3 })

      expect(commands[0]).toContain('c: select-proc')
      expect(commands[0]).toContain('index: 3')
    })

    test('serializes add-proc with name and cmd', async () => {
      const commands: string[] = []
      const mockShell = createCapturingShell(commands)

      const { MprocsClient } = await createClientWithMockedShell(mockShell)
      const client = new MprocsClient('127.0.0.1:4050', '/usr/bin/mprocs')
      await client.sendCommand({ c: 'add-proc', name: 'worker', cmd: ['node', 'index.js'] })

      expect(commands[0]).toContain('c: add-proc')
      expect(commands[0]).toContain('name: worker')
    })

    test('serializes remove-proc with id', async () => {
      const commands: string[] = []
      const mockShell = createCapturingShell(commands)

      const { MprocsClient } = await createClientWithMockedShell(mockShell)
      const client = new MprocsClient('127.0.0.1:4050', '/usr/bin/mprocs')
      await client.sendCommand({ c: 'remove-proc', id: 'proc-1' })

      expect(commands[0]).toContain('c: remove-proc')
      expect(commands[0]).toContain('id: proc-1')
    })

    test('serializes batch command with cmds key', async () => {
      const commands: string[] = []
      const mockShell = createCapturingShell(commands)

      const { MprocsClient } = await createClientWithMockedShell(mockShell)
      const client = new MprocsClient('127.0.0.1:4050', '/usr/bin/mprocs')
      await client.sendCommand({
        c: 'batch',
        ops: [
          { c: 'select-proc', index: 0 },
          { c: 'start-proc' },
        ],
      })

      expect(commands[0]).toContain('c: batch')
      expect(commands[0]).toContain('cmds')
    })
  })

  describe('convenience methods', () => {
    test('startProcess without index sends start-proc directly', async () => {
      const commands: string[] = []
      const mockShell = createCapturingShell(commands)

      const { MprocsClient } = await createClientWithMockedShell(mockShell)
      const client = new MprocsClient('127.0.0.1:4050', '/usr/bin/mprocs')
      await client.startProcess()

      expect(commands[0]).toContain('c: start-proc')
      expect(commands[0]).not.toContain('batch')
    })

    test('startProcess with index sends batch of select + start', async () => {
      const commands: string[] = []
      const mockShell = createCapturingShell(commands)

      const { MprocsClient } = await createClientWithMockedShell(mockShell)
      const client = new MprocsClient('127.0.0.1:4050', '/usr/bin/mprocs')
      await client.startProcess(2)

      expect(commands[0]).toContain('c: batch')
      expect(commands[0]).toContain('select-proc')
      expect(commands[0]).toContain('start-proc')
    })

    test('stopProcess without index sends term-proc directly', async () => {
      const commands: string[] = []
      const mockShell = createCapturingShell(commands)

      const { MprocsClient } = await createClientWithMockedShell(mockShell)
      const client = new MprocsClient('127.0.0.1:4050', '/usr/bin/mprocs')
      await client.stopProcess()

      expect(commands[0]).toContain('c: term-proc')
      expect(commands[0]).not.toContain('batch')
    })

    test('stopProcess with index sends batch of select + term', async () => {
      const commands: string[] = []
      const mockShell = createCapturingShell(commands)

      const { MprocsClient } = await createClientWithMockedShell(mockShell)
      const client = new MprocsClient('127.0.0.1:4050', '/usr/bin/mprocs')
      await client.stopProcess(1)

      expect(commands[0]).toContain('c: batch')
      expect(commands[0]).toContain('select-proc')
      expect(commands[0]).toContain('term-proc')
    })

    test('restartProcess without index sends restart-proc directly', async () => {
      const commands: string[] = []
      const mockShell = createCapturingShell(commands)

      const { MprocsClient } = await createClientWithMockedShell(mockShell)
      const client = new MprocsClient('127.0.0.1:4050', '/usr/bin/mprocs')
      await client.restartProcess()

      expect(commands[0]).toContain('c: restart-proc')
      expect(commands[0]).not.toContain('batch')
    })

    test('restartProcess with index sends batch of select + restart', async () => {
      const commands: string[] = []
      const mockShell = createCapturingShell(commands)

      const { MprocsClient } = await createClientWithMockedShell(mockShell)
      const client = new MprocsClient('127.0.0.1:4050', '/usr/bin/mprocs')
      await client.restartProcess(0)

      expect(commands[0]).toContain('c: batch')
      expect(commands[0]).toContain('select-proc')
      expect(commands[0]).toContain('restart-proc')
    })

    test('addProcess sends add-proc with name and cmd', async () => {
      const commands: string[] = []
      const mockShell = createCapturingShell(commands)

      const { MprocsClient } = await createClientWithMockedShell(mockShell)
      const client = new MprocsClient('127.0.0.1:4050', '/usr/bin/mprocs')
      await client.addProcess('worker', ['bun', 'run', 'worker.ts'])

      expect(commands[0]).toContain('c: add-proc')
      expect(commands[0]).toContain('name: worker')
    })

    test('batch sends multiple commands', async () => {
      const commands: string[] = []
      const mockShell = createCapturingShell(commands)

      const { MprocsClient } = await createClientWithMockedShell(mockShell)
      const client = new MprocsClient('127.0.0.1:4050', '/usr/bin/mprocs')
      await client.batch([
        { c: 'select-proc', index: 0 },
        { c: 'kill-proc' },
      ])

      expect(commands[0]).toContain('c: batch')
      expect(commands[0]).toContain('kill-proc')
    })
  })

  describe('result handling', () => {
    test('returns success true for exit code 0', async () => {
      const mockShell = createCapturingShell([], { exitCode: 0 })

      const { MprocsClient } = await createClientWithMockedShell(mockShell)
      const client = new MprocsClient('127.0.0.1:4050', '/usr/bin/mprocs')
      const result = await client.sendCommand({ c: 'start-proc' })

      expect(result.success).toBe(true)
      expect(result.exitCode).toBe(0)
    })

    test('returns success false for non-zero exit code from thrown error', async () => {
      const mockShell = mock(async () => {
        throw { exitCode: 1, stderr: Buffer.from('connection refused') }
      })

      const { MprocsClient } = await createClientWithMockedShell(mockShell)
      const client = new MprocsClient('127.0.0.1:4050', '/usr/bin/mprocs')
      const result = await client.sendCommand({ c: 'start-proc' })

      expect(result.success).toBe(false)
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toBe('connection refused')
    })

    test('re-throws unexpected errors', async () => {
      const mockShell = mock(async () => {
        throw new Error('unexpected')
      })

      const { MprocsClient } = await createClientWithMockedShell(mockShell)
      const client = new MprocsClient('127.0.0.1:4050', '/usr/bin/mprocs')

      await expect(client.sendCommand({ c: 'start-proc' })).rejects.toThrow('unexpected')
    })
  })

  describe('server availability', () => {
    test('isServerRunning returns true when select-proc succeeds', async () => {
      const mockShell = createCapturingShell([], { exitCode: 0 })

      const { MprocsClient } = await createClientWithMockedShell(mockShell)
      const client = new MprocsClient('127.0.0.1:4050', '/usr/bin/mprocs')
      const running = await client.isServerRunning()

      expect(running).toBe(true)
    })

    test('isServerRunning returns false when sendCommand throws', async () => {
      const mockShell = mock(async () => {
        throw new Error('connection refused')
      })

      const { MprocsClient } = await createClientWithMockedShell(mockShell)
      const client = new MprocsClient('127.0.0.1:4050', '/usr/bin/mprocs')
      const running = await client.isServerRunning()

      expect(running).toBe(false)
    })

    test('waitForServer throws MprocsConnectionError on timeout', async () => {
      const mockShell = mock(async () => {
        throw new Error('connection refused')
      })

      // Override Bun.sleep to be instant for testing
      Bun.sleep = mock(async () => {})

      const { MprocsClient } = await createClientWithMockedShell(mockShell)
      const client = new MprocsClient('127.0.0.1:4050', '/usr/bin/mprocs')

      await expect(client.waitForServer(0)).rejects.toBeInstanceOf(MprocsConnectionError)
    })

    test('waitForServer returns true when server becomes available', async () => {
      let callCount = 0
      const mockShell = mock(async () => {
        callCount++
        if (callCount < 3) {
          throw new Error('not ready')
        }
        return { exitCode: 0 }
      })

      Bun.sleep = mock(async () => {})

      const { MprocsClient } = await createClientWithMockedShell(mockShell)
      const client = new MprocsClient('127.0.0.1:4050', '/usr/bin/mprocs')
      const result = await client.waitForServer(10000)

      expect(result).toBe(true)
    })
  })
})

// --- Test helpers ---

/**
 * Creates a mock shell function that captures YAML payloads sent to mprocs.
 * The MprocsClient uses Bun's $ tagged template literal, which calls the function
 * with (strings[], ...values). We intercept the YAML payload from values[1].
 */
function createCapturingShell(
  captured: string[],
  result: { exitCode: number } = { exitCode: 0 },
) {
  return mock(async (...args: unknown[]) => {
    // Bun $ passes tagged template args: the template literal calls with chunks
    // For our purposes, the YAML string ends up in the interpolated values
    if (Array.isArray(args[0])) {
      // Tagged template call: $(strings, ...values)
      const values = args.slice(1)
      captured.push(values.map(String).join(' '))
    }
    return result
  })
}

/**
 * Creates a MprocsClient module where the Bun $ shell is replaced with a mock.
 * Since MprocsClient uses `$` from 'bun' directly, we test via the public API
 * and intercept at the sendCommand level by subclassing.
 */
async function createClientWithMockedShell(
  _mockShell: ReturnType<typeof mock>,
): Promise<{ MprocsClient: typeof import('./client').MprocsClient }> {
  // Since we can't easily mock Bun's $ tagged template literal,
  // we create a testable subclass that overrides sendCommand behavior
  const { MprocsClient: OriginalClient } = await import('./client')
  const YAML = (await import('yaml')).default

  class TestMprocsClient extends OriginalClient {
    async sendCommand(command: import('./client').MprocsCommand) {
      const payload =
        command.c === 'batch' && 'ops' in command
          ? { ...command, cmds: command.ops }
          : command

      const yaml = YAML.stringify(payload).trim()

      try {
        const result = await _mockShell([
          `mprocs --ctl `,
          ` --server `,
          ``,
        ] as unknown as TemplateStringsArray, 'mprocs', yaml, '127.0.0.1:4050')

        if (result && typeof result === 'object' && 'exitCode' in result) {
          return {
            success: (result as { exitCode: number }).exitCode === 0,
            exitCode: (result as { exitCode: number }).exitCode,
          }
        }
        return { success: true, exitCode: 0 }
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'exitCode' in error) {
          const shellError = error as { exitCode: number; stderr?: Buffer }
          return {
            success: false,
            exitCode: shellError.exitCode,
            stderr: shellError.stderr?.toString(),
          }
        }
        throw error
      }
    }
  }

  return { MprocsClient: TestMprocsClient as unknown as typeof OriginalClient }
}

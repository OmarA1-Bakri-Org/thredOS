import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import YAML from 'yaml'
import { parseCLIArguments } from '../../lib/seqctl/argv'
import { statusCommand } from '../../lib/seqctl/commands/status'
import { RuntimeJsonEnvelopeSchema } from '../../lib/seqctl/runtime-json-schema'

afterEach(() => {
  delete globalThis.__THREADOS_CLI_RUNTIME_SERVICE__
  delete globalThis.__THREADOS_CLI_WATCH_RUNTIME__
  process.exitCode = 0
})

describe('CLI flow', () => {
  test('parses real idempotency and policy confirmation flags', () => {
    expect(parseCLIArguments([
      'run', 'step', 'step-a', '--json', '--idempotency-key', 'stable-key', '--confirm',
    ])).toEqual({
      command: 'run',
      subcommand: 'step',
      args: ['step-a'],
      options: {
        json: true,
        help: false,
        watch: false,
        idempotencyKey: 'stable-key',
        policyConfirmed: true,
      },
    })
  })

  test('rejects a missing idempotency value', () => {
    expect(() => parseCLIArguments(['run', 'list', '--idempotency-key'])).toThrow(
      'Idempotency key value required',
    )
  })

  test('status JSON is a versioned canonical service projection', async () => {
    globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = {
      getStatus: async () => ({
        name: 'canonical-sequence', version: '1.0', steps: [], gates: [],
        summary: { total: 0, ready: 0, running: 0, done: 0, failed: 0, blocked: 0, needsReview: 0 },
      }),
    }
    const lines: string[] = []
    const original = console.log
    console.log = (line: string) => lines.push(line)
    try {
      await statusCommand(undefined, [], {
        json: true, help: false, watch: false, basePath: 'C:\\tmp\\threados-cli',
      })
    } finally {
      console.log = original
    }
    expect(RuntimeJsonEnvelopeSchema.parse(JSON.parse(lines[0]))).toEqual({
      schemaVersion: 1,
      success: true,
      data: {
        name: 'canonical-sequence', version: '1.0', steps: [], gates: [],
        summary: { total: 0, ready: 0, running: 0, done: 0, failed: 0, blocked: 0, needsReview: 0 },
      },
    })
  })

  test('status watch JSON emits compact NDJSON without clearing the console', async () => {
    let reads = 0
    globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = {
      getStatus: async () => ({
        name: `sequence-${++reads}`, version: '1.0', steps: [], gates: [],
        summary: { total: 0, ready: 0, running: 0, done: 0, failed: 0, blocked: 0, needsReview: 0 },
      }),
    }
    let loops = 0
    globalThis.__THREADOS_CLI_WATCH_RUNTIME__ = {
      sleep: async () => {},
      shouldContinue: () => loops++ < 2,
    }
    const lines: string[] = []
    const originalLog = console.log
    const originalClear = console.clear
    let clears = 0
    console.log = (line: string) => lines.push(line)
    console.clear = () => { clears += 1 }
    try {
      await statusCommand(undefined, [], {
        json: true, help: false, watch: true, basePath: 'C:\\tmp\\threados-cli',
      })
    } finally {
      console.log = originalLog
      console.clear = originalClear
    }
    expect(lines).toHaveLength(2)
    for (const line of lines) {
      expect(line).not.toContain('\n')
      expect(RuntimeJsonEnvelopeSchema.parse(JSON.parse(line)).success).toBe(true)
    }
    expect(clears).toBe(0)
  })

  test('real CLI process emits the versioned error envelope and truthful exit code', async () => {
    const basePath = await mkdtemp(join(tmpdir(), 'threados-cli-process-'))
    try {
      await mkdir(join(basePath, '.threados'), { recursive: true })
      await writeFile(join(basePath, '.threados', 'sequence.yaml'), YAML.stringify({
        version: '1.0', id: 'sequence-1', name: 'sequence-1', steps: [], gates: [],
      }))
      const result = Bun.spawnSync({
        cmd: [process.execPath, join(process.cwd(), 'lib', 'seqctl', 'index.ts'), 'run', 'inspect', 'missing-run', '--json'],
        cwd: basePath,
        stdout: 'pipe',
        stderr: 'pipe',
      })
      expect(result.exitCode).toBe(4)
      expect(RuntimeJsonEnvelopeSchema.parse(JSON.parse(new TextDecoder().decode(result.stdout).trim()))).toEqual({
        schemaVersion: 1,
        success: false,
        error: { code: 'RUN_NOT_FOUND', message: 'run missing-run was not found' },
      })
    } finally {
      await rm(basePath, { recursive: true, force: true })
    }
  })

  test('unknown top-level command is a validation error', () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, join(process.cwd(), 'lib', 'seqctl', 'index.ts'), 'not-a-command', '--json'],
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(result.exitCode).toBe(2)
    expect(RuntimeJsonEnvelopeSchema.parse(JSON.parse(new TextDecoder().decode(result.stdout).trim()))).toEqual({
      schemaVersion: 1,
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Unknown command: not-a-command' },
    })
  })
})

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { RuntimeServicePort } from '../api/runtime-request'
import { clearRuntimeServiceFactoryForTests, getThreadOSRuntimeService } from '../runtime/factory'
import type { RuntimeServiceDependencies } from '../runtime/service-types'
import YAML from 'yaml'
import { attemptCommand } from './commands/attempt'
import { runCommand } from './commands/run'
import { RuntimeJsonEnvelopeSchema } from './runtime-json-schema'

const NOW = '2026-07-16T00:00:00.000Z'

async function createRuntimeFixture(basePath: string): Promise<void> {
  await mkdir(join(basePath, '.threados', 'prompts'), { recursive: true })
  await writeFile(join(basePath, '.threados', 'sequence.yaml'), YAML.stringify({
    version: '1.0', id: 'sequence-parity', name: 'sequence-parity',
    steps: [{
      id: 'step-a', name: 'Step A', type: 'base', model: 'codex',
      prompt_file: '.threados/prompts/step-a.md', depends_on: [], status: 'READY',
    }],
    gates: [],
  }))
  await writeFile(join(basePath, '.threados', 'policy.yaml'), YAML.stringify({
    mode: 'POWER', side_effect_mode: 'free',
  }))
  await writeFile(join(basePath, '.threados', 'prompts', 'step-a.md'), '# deterministic parity step')
}

function deterministicRuntime(spawn: () => void): Partial<RuntimeServiceDependencies> {
  const counters = new Map<string, number>()
  return {
    now: () => NOW,
    newId: prefix => {
      const next = (counters.get(prefix) ?? 0) + 1
      counters.set(prefix, next)
      return `${prefix}-${next}`
    },
    dispatch: async (_model, options) => ({
      stepId: options.stepId,
      runId: options.runId,
      command: 'mock-agent',
      args: [],
      cwd: options.cwd,
      timeout: options.timeout,
      executablePayload: { command: 'mock-agent', args: [], cwd: options.cwd },
    }),
    runStep: async config => {
      spawn()
      return {
        stepId: config.stepId, runId: config.runId, exitCode: 0, status: 'SUCCESS' as const,
        duration: 1, stdout: 'ok', stderr: '', startTime: new Date(NOW), endTime: new Date(NOW),
      }
    },
    evaluatePreGates: () => [],
    evaluateCompletionGates: () => [],
    persistGateDecisions: async () => {},
  }
}

async function listFiles(root: string, relative = ''): Promise<string[]> {
  const directory = join(root, relative)
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    const child = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...await listFiles(root, child))
    else if (entry.isFile() && !entry.name.endsWith('.lock')) files.push(child.replaceAll('\\', '/'))
  }
  return files.sort()
}

function normalizeRecord(value: unknown, basePath: string, key = ''): unknown {
  if (key === 'created_via') return '<interface>'
  if (key === 'request_hash') return '<interface-bound-request-hash>'
  if (key.endsWith('_hash')) return '<content-hash>'
  if (typeof value === 'string') {
    return value
      .replaceAll(basePath, '<ROOT>')
      .replaceAll(basePath.replaceAll('\\', '/'), '<ROOT>')
      .replaceAll('runtime:cli', 'runtime:<interface>')
      .replaceAll('runtime:api', 'runtime:<interface>')
  }
  if (Array.isArray(value)) return value.map(item => normalizeRecord(item, basePath))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [
      childKey,
      normalizeRecord(child, basePath, childKey),
    ]))
  }
  return value
}

async function canonicalSnapshot(basePath: string) {
  const threados = join(basePath, '.threados')
  const topology = (await listFiles(threados)).filter(path =>
    path.startsWith('runs/') ||
    path.startsWith('state/runtime-commands/') ||
    path === 'state/runtime-index.json' ||
    path.includes('thread-surface') ||
    path.includes('gate-decision') ||
    path.includes('trace') ||
    path.includes('approval'),
  )
  const records: Record<string, unknown> = {}
  for (const path of topology) {
    const raw = await readFile(join(threados, ...path.split('/')), 'utf8')
    if (path.endsWith('.json')) {
      records[path] = normalizeRecord(JSON.parse(raw), basePath)
    } else if (path.endsWith('.ndjson')) {
      records[path] = raw.trim().split('\n').filter(Boolean).map(line => normalizeRecord(JSON.parse(line), basePath))
    } else {
      records[path] = normalizeRecord(raw, basePath)
    }
  }
  return { topology, records }
}

afterEach(() => {
  delete globalThis.__THREADOS_CLI_RUNTIME_SERVICE__
  delete globalThis.__THREADOS_RUNTIME_SERVICE__
  delete process.env.THREADOS_BASE_PATH
  clearRuntimeServiceFactoryForTests()
  process.exitCode = 0
})

describe.serial('CLI runtime service parity', () => {
  test('run step uses the canonical sequential request and completed projection', async () => {
    let request: unknown
    globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = {
      runAndWait: async (input, context) => {
        request = { input, context }
        return {
          run: { id: 'run-1', status: 'successful' },
          attempts: [{ id: 'attempt-1', status: 'completed', step_id: 'step-a' }],
          replayed: false,
        } as never
      },
    }
    const lines: string[] = []
    const original = console.log
    console.log = (line: string) => lines.push(line)
    try {
      await runCommand('step', ['step-a'], {
        json: true,
        help: false,
        watch: false,
        basePath: 'C:\\tmp\\threados-cli',
        idempotencyKey: 'run-key',
      })
    } finally {
      console.log = original
    }

    expect(request).toEqual({
      input: {
        sequence_id: '$current',
        target: { kind: 'step', step_id: 'step-a' },
        strategy: 'sequential',
        max_concurrency: 1,
        allow_empty: false,
      },
      context: expect.objectContaining({ interface: 'cli', idempotencyKey: 'run-key' }),
    })
    const envelope = RuntimeJsonEnvelopeSchema.parse(JSON.parse(lines[0]))
    expect(envelope.success).toBe(true)
    expect(process.exitCode).toBe(0)
  })

  test('failed completed run emits a failure outcome envelope and exits nonzero', async () => {
    globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = {
      runAndWait: async () => ({
        run: { id: 'run-1', status: 'failed' },
        attempts: [{ id: 'attempt-1', status: 'failed', step_id: 'step-a' }],
        replayed: false,
      }) as never,
    }
    const lines: string[] = []
    const original = console.log
    console.log = (line: string) => lines.push(line)
    try {
      await runCommand('step', ['step-a'], {
        json: true, help: false, watch: false, basePath: 'C:\\tmp\\threados-cli',
      })
    } finally {
      console.log = original
    }

    expect(RuntimeJsonEnvelopeSchema.parse(JSON.parse(lines[0]))).toEqual({
      schemaVersion: 1,
      success: false,
      error: {
        code: 'RUN_FAILED',
        message: "Run 'run-1' finished with status failed",
      },
    })
    expect(process.exitCode).not.toBe(0)
  })

  test('run list delegates to listRuns', async () => {
    let calls = 0
    globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = {
      listRuns: async () => {
        calls += 1
        return [{ run: { id: 'run-1', status: 'successful' }, attempts: [] }] as never
      },
    }
    const lines: string[] = []
    const original = console.log
    console.log = (line: string) => lines.push(line)
    try {
      await runCommand('list', [], {
        json: true, help: false, watch: false, basePath: 'C:\\tmp\\threados-cli',
      })
    } finally {
      console.log = original
    }
    expect(calls).toBe(1)
    expect(RuntimeJsonEnvelopeSchema.parse(JSON.parse(lines[0])).success).toBe(true)
  })

  test('CLI and compatibility API submit equivalent canonical run requests', async () => {
    const calls: Array<{ request: unknown; context: Record<string, unknown> }> = []
    const result = {
      run: { id: 'run-shared', status: 'successful' },
      attempts: [{ id: 'attempt-shared', step_id: 'step-a', status: 'completed' }],
      replayed: false,
    } as never
    const service = {
      runAndWait: async (request: unknown, context: Record<string, unknown>) => {
        calls.push({ request, context })
        return result
      },
    }
    globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = service
    globalThis.__THREADOS_RUNTIME_SERVICE__ = service as unknown as RuntimeServicePort

    const original = console.log
    console.log = () => {}
    try {
      await runCommand('step', ['step-a'], {
        json: true, help: false, watch: false, idempotencyKey: 'parity-key',
      })
    } finally {
      console.log = original
    }
    const { POST } = await import('../../app/api/run/route')
    const response = await POST(new Request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'parity-key' },
      body: JSON.stringify({ stepId: 'step-a' }),
    }))
    expect(response.status).toBe(200)

    expect(calls).toHaveLength(2)
    expect(calls[0].request).toEqual(calls[1].request)
    expect(calls[0].context).toMatchObject({
      actor: 'local@thredos', interface: 'cli', idempotencyKey: 'parity-key',
    })
    expect(calls[1].context).toMatchObject({
      actor: 'local@thredos', interface: 'api', idempotencyKey: 'parity-key',
    })
  })

  test('CLI lifecycle handlers contain no interface-owned runtime lifecycle imports', async () => {
    for (const relative of [
      'lib/seqctl/commands/run.ts',
      'lib/seqctl/commands/control.ts',
      'lib/seqctl/commands/status.ts',
      'lib/seqctl/commands/attempt.ts',
    ]) {
      const source = await readFile(join(process.cwd(), relative), 'utf8')
      expect(source).not.toMatch(/(runner\/(wrapper|dispatch|artifacts|prompt-compiler)|mprocs\/state|thread-surfaces\/(mutations|step-run-runtime)|gates\/|approvals\/)/)
      expect(source).not.toMatch(/\b(writeSequence|writeThreadSurfaceState|runStep|dispatch)\b/)
    }
  })

  test('real CLI and API fixtures persist equivalent canonical trees and CLI replay is spawn-once', async () => {
    const cliPath = await mkdtemp(join(tmpdir(), 'threados-cli-parity-'))
    const apiPath = await mkdtemp(join(tmpdir(), 'threados-api-parity-'))
    let cliSpawns = 0
    let apiSpawns = 0
    try {
      await createRuntimeFixture(cliPath)
      await createRuntimeFixture(apiPath)
      const cliService = await getThreadOSRuntimeService(cliPath, {
        dependencies: deterministicRuntime(() => { cliSpawns += 1 }),
      })
      const apiService = await getThreadOSRuntimeService(apiPath, {
        dependencies: deterministicRuntime(() => { apiSpawns += 1 }),
      })

      globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = cliService
      const originalLog = console.log
      const cliLines: string[] = []
      console.log = (line: string) => cliLines.push(line)
      try {
        const cliOptions = {
          json: true, help: false, watch: false, basePath: cliPath,
          idempotencyKey: 'real-parity-key', policyConfirmed: true,
        }
        await runCommand('step', ['step-a'], cliOptions)
        await runCommand('step', ['step-a'], cliOptions)
        await runCommand('runnable', [], cliOptions)
      } finally {
        console.log = originalLog
      }
      expect(cliSpawns).toBe(1)
      expect(RuntimeJsonEnvelopeSchema.parse(JSON.parse(cliLines[0])).success).toBe(true)
      expect(RuntimeJsonEnvelopeSchema.parse(JSON.parse(cliLines[1])).success).toBe(true)
      expect(RuntimeJsonEnvelopeSchema.parse(JSON.parse(cliLines[2]))).toMatchObject({
        success: false,
        error: { code: 'IDEMPOTENCY_CONFLICT' },
      })
      expect(process.exitCode).toBe(5)

      globalThis.__THREADOS_RUNTIME_SERVICE__ = apiService
      process.env.THREADOS_BASE_PATH = apiPath
      const { POST } = await import('../../app/api/run/route')
      const response = await POST(new Request('http://localhost/api/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'real-parity-key' },
        body: JSON.stringify({ stepId: 'step-a', confirmPolicy: true }),
      }))
      expect(response.status).toBe(200)
      expect(apiSpawns).toBe(1)

      const cliProjection = await cliService.inspectRun('run-1')
      const apiProjection = await apiService.inspectRun('run-1')
      expect(normalizeRecord(cliProjection, cliPath)).toEqual(normalizeRecord(apiProjection, apiPath))
      expect(await canonicalSnapshot(cliPath)).toEqual(await canonicalSnapshot(apiPath))

      process.exitCode = 0
      const retryLines: string[] = []
      console.log = (line: string) => retryLines.push(line)
      try {
        const originalAttemptId = cliProjection.attempts[0].id
        const retryOptions = {
          json: true, help: false, watch: false, basePath: cliPath,
          idempotencyKey: 'real-retry-key', policyConfirmed: true,
        }
        await attemptCommand('retry', [originalAttemptId], retryOptions)
        await attemptCommand('retry', [originalAttemptId], retryOptions)
      } finally {
        console.log = originalLog
      }
      for (let poll = 0; cliSpawns < 2 && poll < 200; poll += 1) {
        await Bun.sleep(10)
      }
      expect(cliSpawns).toBe(2)
      const firstRetry = RuntimeJsonEnvelopeSchema.parse(JSON.parse(retryLines[0]))
      const replayedRetry = RuntimeJsonEnvelopeSchema.parse(JSON.parse(retryLines[1]))
      expect(firstRetry).toMatchObject({
        success: true,
        data: { attempt: { retry_of_attempt_id: cliProjection.attempts[0].id } },
      })
      expect(replayedRetry).toMatchObject({
        success: true,
        data: { attempt: { id: 'attempt-2', retry_of_attempt_id: cliProjection.attempts[0].id } },
      })
      const retries = (await cliService.listRuns())
        .flatMap(projection => projection.attempts)
        .filter(attempt => attempt.retry_of_attempt_id === cliProjection.attempts[0].id)
      expect(retries).toHaveLength(1)
      expect(retries[0].id).toBe('attempt-2')
    } finally {
      delete globalThis.__THREADOS_CLI_RUNTIME_SERVICE__
      delete globalThis.__THREADOS_RUNTIME_SERVICE__
      delete process.env.THREADOS_BASE_PATH
      clearRuntimeServiceFactoryForTests()
      process.exitCode = 0
      await rm(cliPath, { recursive: true, force: true })
      await rm(apiPath, { recursive: true, force: true })
    }
  }, 30_000)
})

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import YAML from 'yaml'
import type { RuntimeServicePort } from '@/lib/api/runtime-request'
import { clearRuntimeServiceFactoryForTests, getThreadOSRuntimeService } from '@/lib/runtime/factory'
import type { RuntimeServiceDependencies } from '@/lib/runtime/service-types'
import { runCommand } from '@/lib/seqctl/commands/run'

const NOW = '2026-07-16T00:00:00.000Z'

async function createFixture(basePath: string): Promise<void> {
  await mkdir(join(basePath, '.threados', 'prompts'), { recursive: true })
  await writeFile(join(basePath, '.threados', 'sequence.yaml'), YAML.stringify({
    version: '1.0',
    id: 'sequence-parity',
    name: 'sequence-parity',
    steps: [{
      id: 'step-a',
      name: 'Step A',
      type: 'base',
      model: 'codex',
      prompt_file: '.threados/prompts/step-a.md',
      depends_on: [],
      status: 'READY',
    }],
    gates: [],
  }))
  await writeFile(join(basePath, '.threados', 'policy.yaml'), YAML.stringify({
    mode: 'POWER',
    side_effect_mode: 'free',
  }))
  await writeFile(join(basePath, '.threados', 'prompts', 'step-a.md'), '# parity')
}

function deterministicDependencies(onSpawn: () => void): Partial<RuntimeServiceDependencies> {
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
      executablePayload: {
        command: 'mock-agent',
        args: [],
        cwd: options.cwd,
      },
    }),
    runStep: async config => {
      onSpawn()
      return {
        stepId: config.stepId,
        runId: config.runId,
        exitCode: 0,
        status: 'SUCCESS' as const,
        duration: 1,
        stdout: 'ok',
        stderr: '',
        startTime: new Date(NOW),
        endTime: new Date(NOW),
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
    if (entry.isDirectory()) {
      files.push(...await listFiles(root, child))
    } else if (entry.isFile() && !entry.name.endsWith('.lock')) {
      files.push(child.replaceAll('\\', '/'))
    }
  }
  return files.sort()
}

function normalize(value: unknown, basePath: string, key = ''): unknown {
  if (key === 'created_via') return '<interface>'
  if (key === 'request_hash') return '<interface-request-hash>'
  if (key.endsWith('_hash')) return '<content-hash>'
  if (typeof value === 'string') {
    return value
      .replaceAll(basePath, '<ROOT>')
      .replaceAll(basePath.replaceAll('\\', '/'), '<ROOT>')
      .replaceAll('runtime:cli', 'runtime:<interface>')
      .replaceAll('runtime:api', 'runtime:<interface>')
  }
  if (Array.isArray(value)) return value.map(item => normalize(item, basePath))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [
      childKey,
      normalize(child, basePath, childKey),
    ]))
  }
  return value
}

async function canonicalStateTree(basePath: string) {
  const root = join(basePath, '.threados')
  const topology = (await listFiles(root)).filter(path =>
    path.startsWith('runs/')
    || path.startsWith('state/runtime-commands/')
    || path === 'state/runtime-index.json'
    || path.includes('thread-surface')
    || path.includes('gate-decision')
    || path.includes('trace')
    || path.includes('approval'),
  )
  const records: Record<string, unknown> = {}
  for (const path of topology) {
    const raw = await readFile(join(root, ...path.split('/')), 'utf8')
    if (path.endsWith('.json')) {
      records[path] = normalize(JSON.parse(raw), basePath)
    } else if (path.endsWith('.ndjson')) {
      records[path] = raw.trim().split('\n').filter(Boolean)
        .map(line => normalize(JSON.parse(line), basePath))
    } else {
      records[path] = normalize(raw, basePath)
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

describe.serial('API and CLI canonical runtime parity', () => {
  test('one sequential attempt produces the same canonical state tree through either interface', async () => {
    const cliPath = await mkdtemp(join(tmpdir(), 'threados-m0-cli-parity-'))
    const apiPath = await mkdtemp(join(tmpdir(), 'threados-m0-api-parity-'))
    let cliSpawns = 0
    let apiSpawns = 0
    try {
      await createFixture(cliPath)
      await createFixture(apiPath)
      const cliDependencies = deterministicDependencies(() => { cliSpawns += 1 })
      const apiDependencies = deterministicDependencies(() => { apiSpawns += 1 })
      const cliService = await getThreadOSRuntimeService(cliPath, {
        dependencies: cliDependencies,
        testCompatibility: { runStep: cliDependencies.runStep! },
      })
      const apiService = await getThreadOSRuntimeService(apiPath, {
        dependencies: apiDependencies,
        testCompatibility: { runStep: apiDependencies.runStep! },
      })

      globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = cliService
      const originalLog = console.log
      console.log = () => {}
      try {
        await runCommand('step', ['step-a'], {
          json: true,
          help: false,
          watch: false,
          basePath: cliPath,
          idempotencyKey: 'm0-parity-key',
          policyConfirmed: true,
        })
      } finally {
        console.log = originalLog
      }

      globalThis.__THREADOS_RUNTIME_SERVICE__ = apiService as RuntimeServicePort
      process.env.THREADOS_BASE_PATH = apiPath
      const { POST } = await import('@/app/api/run/route')
      const response = await POST(new Request('http://localhost/api/run', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'm0-parity-key',
        },
        body: JSON.stringify({ stepId: 'step-a', confirmPolicy: true }),
      }))

      expect(response.status).toBe(200)
      expect(cliSpawns).toBe(1)
      expect(apiSpawns).toBe(1)

      const cliProjection = await cliService.inspectRun('run-1')
      const apiProjection = await apiService.inspectRun('run-1')
      expect(normalize(cliProjection, cliPath)).toEqual(normalize(apiProjection, apiPath))
      expect(cliProjection).toMatchObject({
        source: 'v2',
        run: { status: 'successful' },
        attempts: [{ status: 'completed' }],
      })
      expect(await canonicalStateTree(cliPath)).toEqual(await canonicalStateTree(apiPath))
    } finally {
      await rm(cliPath, { recursive: true, force: true })
      await rm(apiPath, { recursive: true, force: true })
    }
  }, 30_000)
})

import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'child_process'

function runIsolated(script: string) {
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Subprocess exited with code ${result.status}`)
  }

  return JSON.parse(result.stdout.trim()) as Record<string, unknown>
}

describe.serial('mutation integrity', () => {
  test('step add rolls back the sequence when thread-surface persistence fails', () => {
    const result = runIsolated(`
      import { mkdtemp, mkdir } from 'fs/promises'
      import { existsSync } from 'fs'
      import { tmpdir } from 'os'
      import { join } from 'path'
      import { mock } from 'bun:test'
      import { ThreadSurfaceStateConflictError } from './lib/errors'
      import { readSequence, writeSequence } from './lib/sequence/parser'

      const basePath = await mkdtemp(join(tmpdir(), 'step-add-rollback-'))
      process.env.THREDOS_BASE_PATH = basePath
      await mkdir(join(basePath, '.threados', 'prompts'), { recursive: true })
      await writeSequence(basePath, { version: '1.0', name: 'base', steps: [], gates: [] })

      const actualRepo = await import('./lib/thread-surfaces/repository.ts?step-add-repo')
      let writeCount = 0
      mock.module('@/lib/thread-surfaces/repository', () => ({
        ...actualRepo,
        writeThreadSurfaceState: async (...args) => {
          writeCount += 1
          if (writeCount === 1) throw new ThreadSurfaceStateConflictError()
          return undefined
        },
      }))

      const { POST } = await import('./app/api/step/route.ts?step-add-rollback')
      const response = await POST(new Request('http://localhost/api/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', stepId: 'build', name: 'Build' }),
      }))
      const sequence = await readSequence(basePath)
      console.log(JSON.stringify({
        status: response.status,
        stepIds: sequence.steps.map(step => step.id),
        promptExists: existsSync(join(basePath, '.threados', 'prompts', 'build.md')),
      }))
    `)

    expect(result.status).toBe(409)
    expect(result.stepIds).toEqual([])
    expect(result.promptExists).toBe(false)
  })

  test('step remove rolls back the sequence when thread-surface persistence fails', () => {
    const result = runIsolated(`
      import { mkdtemp, mkdir, writeFile } from 'fs/promises'
      import { tmpdir } from 'os'
      import { join } from 'path'
      import YAML from 'yaml'
      import { mock } from 'bun:test'
      import { ThreadSurfaceStateConflictError } from './lib/errors'
      import { readSequence } from './lib/sequence/parser'

      const basePath = await mkdtemp(join(tmpdir(), 'step-remove-rollback-'))
      process.env.THREDOS_BASE_PATH = basePath
      await mkdir(join(basePath, '.threados', 'prompts'), { recursive: true })
      await writeFile(join(basePath, '.threados', 'sequence.yaml'), YAML.stringify({
        version: '1.0',
        name: 'base',
        steps: [{ id: 'build', name: 'Build', type: 'base', model: 'claude-code', prompt_file: '.threados/prompts/build.md', depends_on: [], status: 'READY' }],
        gates: [],
      }))
      await writeFile(join(basePath, '.threados', 'prompts', 'build.md'), '# Build')

      const actualRepo = await import('./lib/thread-surfaces/repository.ts?step-remove-repo')
      let writeCount = 0
      mock.module('@/lib/thread-surfaces/repository', () => ({
        ...actualRepo,
        writeThreadSurfaceState: async (...args) => {
          writeCount += 1
          if (writeCount === 1) throw new ThreadSurfaceStateConflictError()
          return undefined
        },
      }))

      const { POST } = await import('./app/api/step/route.ts?step-remove-rollback')
      const response = await POST(new Request('http://localhost/api/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rm', stepId: 'build' }),
      }))
      const sequence = await readSequence(basePath)
      console.log(JSON.stringify({
        status: response.status,
        stepIds: sequence.steps.map(step => step.id),
      }))
    `)

    expect(result.status).toBe(409)
    expect(result.stepIds).toEqual(['build'])
  })

  test('apply-template rolls back sequence changes when thread-surface persistence fails', () => {
    const result = runIsolated(`
      import { mkdtemp, mkdir } from 'fs/promises'
      import { existsSync } from 'fs'
      import { tmpdir } from 'os'
      import { join } from 'path'
      import { mock } from 'bun:test'
      import { ThreadSurfaceStateConflictError } from './lib/errors'
      import { readSequence, writeSequence } from './lib/sequence/parser'

      const basePath = await mkdtemp(join(tmpdir(), 'template-rollback-'))
      process.env.THREDOS_BASE_PATH = basePath
      await mkdir(join(basePath, '.threados'), { recursive: true })
      await writeSequence(basePath, { version: '1.0', name: 'base', steps: [], gates: [] })

      const actualRepo = await import('./lib/thread-surfaces/repository.ts?template-rollback-repo')
      let writeCount = 0
      mock.module('@/lib/thread-surfaces/repository', () => ({
        ...actualRepo,
        writeThreadSurfaceState: async (...args) => {
          writeCount += 1
          if (writeCount === 1) throw new ThreadSurfaceStateConflictError()
          return undefined
        },
      }))

      const { POST } = await import('./app/api/sequence/route.ts?template-rollback')
      const response = await POST(new Request('http://localhost/api/sequence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apply-template', type: 'base', name: 'Template Name' }),
      }))
      const sequence = await readSequence(basePath)
      console.log(JSON.stringify({
        status: response.status,
        name: sequence.name,
        stepCount: sequence.steps.length,
        promptExists: existsSync(join(basePath, '.threados', 'prompts', 'step-1.md')),
      }))
    `)

    expect(result.status).toBe(409)
    expect(result.name).toBe('base')
    expect(result.stepCount).toBe(0)
    expect(result.promptExists).toBe(false)
  })

  test('chat validator rolls back sequence changes when thread-surface persistence fails', () => {
    const result = runIsolated(`
      import { mkdtemp, mkdir } from 'fs/promises'
      import { tmpdir } from 'os'
      import { join } from 'path'
      import { mock } from 'bun:test'
      import { ThreadSurfaceStateConflictError } from './lib/errors'
      import { readSequence, writeSequence } from './lib/sequence/parser'

      const basePath = await mkdtemp(join(tmpdir(), 'chat-apply-rollback-'))
      process.env.THREDOS_BASE_PATH = basePath
      await mkdir(join(basePath, '.threados'), { recursive: true })
      await writeSequence(basePath, {
        version: '1.0',
        name: 'chat-base',
        steps: [{ id: 'init', name: 'Init', type: 'base', model: 'claude-code', prompt_file: 'prompts/init.md', depends_on: [], status: 'DONE' }],
        gates: [],
      })

      const actualRepo = await import('./lib/thread-surfaces/repository.ts?chat-rollback-repo')
      mock.module('@/lib/thread-surfaces/repository', () => ({
        ...actualRepo,
        writeThreadSurfaceState: async () => {
          throw new ThreadSurfaceStateConflictError()
        },
      }))

      const { ActionValidator } = await import('./lib/chat/validator.ts?chat-rollback-validator')
      const validator = new ActionValidator(basePath)
      const result = await validator.apply([
        { command: 'step add', args: { id: 'build', name: 'Build', type: 'base', model: 'claude-code', prompt_file: 'prompts/build.md' } },
      ])
      const sequence = await readSequence(basePath)
      console.log(JSON.stringify({
        success: result.success,
        stepIds: sequence.steps.map(step => step.id),
      }))
    `)

    expect(result.success).toBe(false)
    expect(result.stepIds).toEqual(['init'])
  })
})

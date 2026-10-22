import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import YAML from 'yaml'

let basePath: string

async function readPersistedSequence() {
  return YAML.parse(await readFile(join(basePath, '.threados', 'sequence.yaml'), 'utf8'))
}

describe.serial('step API runtime configuration contract', () => {
  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-step-runtime-api-'))
    process.env.THREADOS_BASE_PATH = basePath
    await mkdir(join(basePath, '.threados', 'prompts'), { recursive: true })
    await writeFile(join(basePath, '.threados', 'sequence.yaml'), YAML.stringify({
      version: '1.0',
      name: 'runtime-contract',
      steps: [{
        id: 'step-a', name: 'Step A', type: 'base', model: 'codex',
        prompt_file: '.threados/prompts/step-a.md', depends_on: [], status: 'READY',
      }],
      gates: [],
    }))
    await writeFile(join(basePath, '.threados', 'prompts', 'step-a.md'), '# Step A')
  })

  afterEach(async () => {
    delete process.env.THREADOS_BASE_PATH
    await rm(basePath, { recursive: true, force: true })
  })

  test('add accepts explicit sideEffect and workspace settings', async () => {
    const { POST } = await import('@/app/api/step/route')
    const response = await POST(new Request('http://localhost/api/step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'add', stepId: 'step-b', model: 'shell', cwd: 'packages/worker',
        sideEffectClass: 'read', workspaceMode: 'isolated',
      }),
    }))

    expect(response.status).toBe(200)
    const sequence = await readPersistedSequence()
    expect(sequence.steps[1]).toMatchObject({
      id: 'step-b', cwd: 'packages/worker', side_effect_class: 'read', workspace_mode: 'isolated',
    })
  })

  test('edit accepts explicit sideEffect and workspace settings', async () => {
    const { POST } = await import('@/app/api/step/route')
    const response = await POST(new Request('http://localhost/api/step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'edit', stepId: 'step-a', sideEffectClass: 'execute', workspaceMode: 'isolated',
      }),
    }))

    expect(response.status).toBe(200)
    expect((await readPersistedSequence()).steps[0]).toMatchObject({
      side_effect_class: 'execute', workspace_mode: 'isolated',
    })
  })

  test('rejects absolute and traversing cwd values without persisting a step', async () => {
    const { POST } = await import('@/app/api/step/route')

    for (const [stepId, cwd] of [['step-absolute', '/tmp/workdir'], ['step-traversal', '../escape']]) {
      const response = await POST(new Request('http://localhost/api/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', stepId, cwd }),
      }))
      expect(response.status).toBe(400)
    }

    const ids = (await readPersistedSequence()).steps.map((step: { id: string }) => step.id)
    expect(ids).not.toContain('step-absolute')
    expect(ids).not.toContain('step-traversal')
  })

  test('rejects a traversing cwd edit without changing the step', async () => {
    const { POST } = await import('@/app/api/step/route')
    const response = await POST(new Request('http://localhost/api/step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'edit', stepId: 'step-a', cwd: '../escape' }),
    }))

    expect(response.status).toBe(400)
    expect((await readPersistedSequence()).steps[0].cwd).toBeUndefined()
  })
})

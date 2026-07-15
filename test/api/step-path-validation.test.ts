import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import YAML from 'yaml'

describe.serial('POST /api/step file identifier validation', () => {
  let basePath: string
  let sequencePath: string

  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'thredos-step-paths-'))
    process.env.THREADOS_BASE_PATH = basePath
    sequencePath = join(basePath, '.threados', 'sequence.yaml')
    await mkdir(join(basePath, '.threados', 'prompts'), { recursive: true })
    await writeFile(sequencePath, YAML.stringify({
      version: '1.0',
      name: 'path-validation',
      steps: [{
        id: 'step-a', name: 'Step A', type: 'base', model: 'test',
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

  async function post(body: unknown) {
    const { POST } = await import('@/app/api/step/route')
    return await POST(new Request('http://localhost/api/step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }))
  }

  for (const body of [
    { action: 'add', stepId: '../escape' },
    { action: 'edit', stepId: '../escape', name: 'unsafe' },
    { action: 'rm', stepId: '../escape' },
    { action: 'clone', sourceId: '../escape', newId: 'safe-copy' },
    { action: 'clone', sourceId: 'step-a', newId: '../escape' },
  ]) {
    test(`returns 400 before mutation for ${body.action} unsafe identifier`, async () => {
      const before = await readFile(sequencePath, 'utf-8')
      const response = await post(body)

      expect(response.status).toBe(400)
      expect((await response.json()).code).toBe('VALIDATION_ERROR')
      expect(await readFile(sequencePath, 'utf-8')).toBe(before)
    })
  }
})

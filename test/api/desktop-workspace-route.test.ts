import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync } from 'fs'
import { mkdir, mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadWorkspaceConfig } from '@/lib/workspaces/config'

let root = ''
let project = ''
let runtime = ''
let previousBasePath: string | undefined
let previousHosted: string | undefined

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'threados-workspace-route-'))
  project = join(root, 'project')
  runtime = join(root, 'runtime')
  await Promise.all([mkdir(project), mkdir(runtime)])
  previousBasePath = process.env.THREDOS_BASE_PATH
  previousHosted = process.env.THREDOS_HOSTED
  process.env.THREDOS_BASE_PATH = project
  delete process.env.THREDOS_HOSTED
})

afterEach(async () => {
  if (previousBasePath === undefined) delete process.env.THREDOS_BASE_PATH
  else process.env.THREDOS_BASE_PATH = previousBasePath
  if (previousHosted === undefined) delete process.env.THREDOS_HOSTED
  else process.env.THREDOS_HOSTED = previousHosted
  await rm(root, { recursive: true, force: true })
})

describe('desktop workspace runtime configuration', () => {
  test('persists an external runtime root and returns its resolved projection', async () => {
    const { POST, GET } = await import('@/app/api/desktop/workspace/route')
    const response = await POST(new Request('http://localhost/api/desktop/workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runtimeDataRoot: runtime }),
    }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.workspace.runtimeDataRoot).toBe(runtime)
    expect(body.workspace.exclusionPolicyHash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect((await loadWorkspaceConfig(project)).runtime_data_root).toBe(runtime)

    const read = await GET(new Request('http://localhost/api/desktop/workspace'))
    expect((await read.json()).workspace.runtimeDataRoot).toBe(runtime)
  })

  test('rejects combined config and identity mutations without partial writes', async () => {
    const { POST } = await import('@/app/api/desktop/workspace/route')
    const response = await POST(new Request('http://localhost/api/desktop/workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runtimeDataRoot: runtime, label: 'Combined update' }),
    }))
    expect(response.status).toBe(400)
    expect(existsSync(join(project, '.threados', 'workspace.yaml'))).toBe(false)
  })

  test('rejects an override inside the canonical project before writing config', async () => {
    const { POST } = await import('@/app/api/desktop/workspace/route')
    const response = await POST(new Request('http://localhost/api/desktop/workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runtimeDataRoot: join(project, '.threados', 'runtime') }),
    }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'INVALID_RUNTIME_DATA_ROOT' })
    expect(existsSync(join(project, '.threados', 'workspace.yaml'))).toBe(false)
  })
})

import { afterEach, expect, test } from 'bun:test'
import { createPr11Fixture, type Pr11Fixture } from './pr11-workspace-test-helper'
import { workspaceCommand } from '@/lib/seqctl/commands/workspace'
import type { WorkspaceInspection } from '@/lib/workspaces/inspection'

let fixture: Pr11Fixture | null = null
const previousBasePath = process.env.THREDOS_BASE_PATH
const previousAlias = process.env.THREADOS_BASE_PATH

afterEach(async () => {
  if (previousBasePath === undefined) delete process.env.THREDOS_BASE_PATH
  else process.env.THREDOS_BASE_PATH = previousBasePath
  if (previousAlias === undefined) delete process.env.THREADOS_BASE_PATH
  else process.env.THREADOS_BASE_PATH = previousAlias
  process.exitCode = 0
  await fixture?.cleanup()
  fixture = null
})

async function cliWorkspace(
  command: 'inspect' | 'list',
  args: string[],
  basePath: string,
): Promise<Record<string, unknown>> {
  const lines: string[] = []
  const original = console.log
  console.log = (line: string) => lines.push(line)
  try {
    await workspaceCommand(command, args, {
      json: true,
      help: false,
      watch: false,
      basePath,
    })
  } finally {
    console.log = original
  }
  expect(process.exitCode).toBe(0)
  return JSON.parse(lines[0]!) as Record<string, unknown>
}

test('API and CLI inspect and control the same retained workspace record', async () => {
  fixture = await createPr11Fixture(['write-one'], undefined, true)
  process.env.THREDOS_BASE_PATH = fixture.canonical
  process.env.THREADOS_BASE_PATH = fixture.canonical
  const run = await fixture.run()
  expect(run.attempts[0]?.status).toBe('completed')

  const { GET: list } = await import('@/app/api/workspaces/route')
  const listResponse = await list(new Request(`http://localhost/api/workspaces?run_id=${run.run.id}`))
  expect(listResponse.status).toBe(200)
  const apiList = await listResponse.json() as { workspaces: Array<{ id: string; status: string }> }
  expect(apiList.workspaces).toHaveLength(1)
  expect(apiList.workspaces[0]?.status).toBe('retained')
  const workspaceId = apiList.workspaces[0]!.id

  const cliList = await cliWorkspace('list', ['--run', run.run.id], fixture.canonical)
  expect((cliList.data as { workspaces: unknown[] }).workspaces).toEqual(apiList.workspaces)

  const { GET: detail } = await import('@/app/api/workspaces/[workspaceId]/route')
  const apiDetail = await detail(new Request(`http://localhost/api/workspaces/${workspaceId}`), {
    params: Promise.resolve({ workspaceId }),
  })
  expect(apiDetail.status).toBe(200)
  const inspection = await apiDetail.json() as WorkspaceInspection
  expect(inspection.workspace.id).toBe(workspaceId)
  expect(inspection.verification.exists).toBe(true)
  const cliDetail = await cliWorkspace('inspect', [workspaceId], fixture.canonical)
  expect(cliDetail.data).toEqual(inspection)

  const { POST: clean } = await import('@/app/api/workspaces/[workspaceId]/clean/route')
  const cleaned = await clean(new Request(`http://localhost/api/workspaces/${workspaceId}/clean`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'real-workspace-clean' },
    body: JSON.stringify({ policy_confirmed: true }),
  }), { params: Promise.resolve({ workspaceId }) })
  expect(cleaned.status).toBe(200)
  expect((await cleaned.json() as WorkspaceInspection).workspace.status).toBe('cleaned')

  const cliAfterClean = await cliWorkspace('inspect', [workspaceId], fixture.canonical)
  expect((cliAfterClean.data as WorkspaceInspection).workspace.status).toBe('cleaned')
  expect((cliAfterClean.data as WorkspaceInspection).verification.exists).toBe(false)
}, 60_000)

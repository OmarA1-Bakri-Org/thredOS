import { afterEach, expect, test } from 'bun:test'
import { rm } from 'fs/promises'
import { join } from 'path'
import { createPr11Fixture, type Pr11Fixture } from './pr11-workspace-test-helper'
import { getThreadOSRuntimeService } from '@/lib/runtime/factory'
import type { RuntimeServicePort } from '@/lib/api/runtime-request'
import { main } from '@/lib/seqctl/index'
import { readThreadSurfaceState, writeThreadSurfaceState } from '@/lib/thread-surfaces/repository'
import type { ThreadSurface } from '@/lib/thread-surfaces/types'

let fixture: Pr11Fixture | null = null
async function persistSharedSurface(basePath: string, surfaceId: string): Promise<void> {
  const state = await readThreadSurfaceState(basePath)
  const shared: ThreadSurface = {
    id: surfaceId, parentSurfaceId: null, parentAgentNodeId: null, depth: 0,
    surfaceLabel: 'Shared', createdAt: new Date().toISOString(), childSurfaceIds: [],
    sequenceRef: null, spawnedByAgentId: null, surfaceClass: 'shared',
    visibility: 'dependency', isolationLabel: 'THREADOS_SCOPED', revealState: null,
    allowedReadScopes: [], allowedWriteScopes: [],
  }
  await writeThreadSurfaceState(basePath, {
    ...state, threadSurfaces: [...state.threadSurfaces.filter(surface => surface.id !== surfaceId), shared],
  })
}
afterEach(async () => {
  delete globalThis.__THREADOS_RUNTIME_SERVICE__
  delete globalThis.__THREADOS_CLI_RUNTIME_SERVICE__
  process.exitCode = 0
  await fixture?.cleanup()
  fixture = null
})

test('API and CLI review and decide through one persisted Change Set service', async () => {
  fixture = await createPr11Fixture(['parity'])
  const outcome = await fixture.run()
  const attempt = outcome.attempts[0]!
  await persistSharedSurface(fixture.canonical, attempt.surface_id)
  const service = await getThreadOSRuntimeService(fixture.canonical)
  globalThis.__THREADOS_RUNTIME_SERVICE__ = service as RuntimeServicePort
  globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = service

  const { GET: apiList } = await import('@/app/api/change-sets/route')
  const listed = await apiList(new Request(`http://localhost/api/change-sets?run_id=${outcome.run.id}`))
  expect(listed.status).toBe(200)
  expect(await listed.json()).toMatchObject({ change_sets: [{ id: attempt.change_set_id, revision: 1,
    status: 'validated', validation: { status: 'passed' } }] })

  const { GET: apiInspect } = await import('@/app/api/change-sets/[changeSetId]/route')
  const inspected = await apiInspect(new Request(`http://localhost/api/change-sets/${attempt.change_set_id}`), {
    params: Promise.resolve({ changeSetId: attempt.change_set_id! }),
  })
  expect(inspected.status).toBe(200)
  expect(await inspected.json()).toMatchObject({ summary: { id: attempt.change_set_id } })

  const lines: string[] = []
  const originalLog = console.log
  console.log = (line: string) => { lines.push(line) }
  try { await main(['changes', 'show', attempt.change_set_id!, '--json']) }
  finally { console.log = originalLog }
  expect(process.exitCode).toBe(0)
  expect(lines[0]).toContain('agent-parity.txt')
  expect(lines[0]).not.toContain(fixture.runtime)

  const { POST: apiSelect } = await import('@/app/api/change-sets/[changeSetId]/select/route')
  const selected = await apiSelect(new Request(`http://localhost/api/change-sets/${attempt.change_set_id}/select`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'api-select' },
    body: JSON.stringify({ expected_revision: 1 }),
  }), { params: Promise.resolve({ changeSetId: attempt.change_set_id! }) })
  expect(selected.status).toBe(200)
  expect(await selected.json()).toMatchObject({ change_set: { status: 'selected', revision: 2 } })

  lines.length = 0
  console.log = (line: string) => { lines.push(line) }
  try { await main(['changes', 'reject', attempt.change_set_id!, 'Rejected', 'after', 'review',
    '--idempotency-key', 'cli-reject', '--json']) }
  finally { console.log = originalLog }
  expect(process.exitCode).toBe(0)
  expect(lines[0]).toContain('"status":"rejected"')
  expect((await service.listChangeSets(outcome.run.id))[0]).toMatchObject({ status: 'rejected', revision: 3 })
}, 60_000)

test('API and CLI deny sealed semantic review until the surface is revealed', async () => {
  fixture = await createPr11Fixture(['sealed'])
  const outcome = await fixture.run()
  const attempt = outcome.attempts[0]!
  await rm(join(fixture.canonical, '.threados', 'surfaces', attempt.surface_id), { recursive: true, force: true })
  const service = await getThreadOSRuntimeService(fixture.canonical)
  globalThis.__THREADOS_RUNTIME_SERVICE__ = service as RuntimeServicePort
  globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = service
  const { GET: missingList } = await import('@/app/api/change-sets/route')
  const missingListed = await missingList(new Request(`http://localhost/api/change-sets?run_id=${outcome.run.id}`))
  expect(await missingListed.json()).toMatchObject({ change_sets: [] })
  const { GET: missingInspect } = await import('@/app/api/change-sets/[changeSetId]/route')
  const missingDetail = await missingInspect(new Request(`http://localhost/api/change-sets/${attempt.change_set_id}`), {
    params: Promise.resolve({ changeSetId: attempt.change_set_id! }),
  })
  expect(missingDetail.status).toBe(403)
  expect(JSON.stringify(await missingDetail.json())).not.toContain('agent-sealed.txt')
  const missingLines: string[] = []
  const originalMissingLog = console.log
  console.log = (line: string) => { missingLines.push(line) }
  try { await main(['changes', 'show', attempt.change_set_id!, '--json']) }
  finally { console.log = originalMissingLog }
  expect(process.exitCode).toBe(3)
  expect(missingLines[0]).not.toContain('agent-sealed.txt')
  const state = await readThreadSurfaceState(fixture.canonical)
  const sealed: ThreadSurface = {
    id: attempt.surface_id, parentSurfaceId: null, parentAgentNodeId: null, depth: 0,
    surfaceLabel: 'Sealed', createdAt: new Date().toISOString(), childSurfaceIds: [],
    sequenceRef: null, spawnedByAgentId: null, surfaceClass: 'sealed',
    visibility: 'self_only', isolationLabel: 'THREADOS_SCOPED', revealState: 'sealed',
    allowedReadScopes: [], allowedWriteScopes: [],
  }
  await writeThreadSurfaceState(fixture.canonical, {
    ...state, threadSurfaces: [...state.threadSurfaces.filter(surface => surface.id !== sealed.id), sealed],
  })
  const { GET: apiList } = await import('@/app/api/change-sets/route')
  const listed = await apiList(new Request(`http://localhost/api/change-sets?run_id=${outcome.run.id}`))
  expect(await listed.json()).toMatchObject({ change_sets: [] })
  const { GET: apiInspect } = await import('@/app/api/change-sets/[changeSetId]/route')
  const detail = () => apiInspect(new Request(`http://localhost/api/change-sets/${attempt.change_set_id}`), {
    params: Promise.resolve({ changeSetId: attempt.change_set_id! }),
  })
  const blocked = await detail()
  expect(blocked.status).toBe(403)
  expect(JSON.stringify(await blocked.json())).not.toContain('agent-sealed.txt')
  const lines: string[] = []
  const original = console.log
  console.log = (line: string) => { lines.push(line) }
  try { await main(['changes', 'show', attempt.change_set_id!, '--json']) }
  finally { console.log = original }
  expect(process.exitCode).toBe(3)
  expect(lines[0]).not.toContain('agent-sealed.txt')

  const current = await readThreadSurfaceState(fixture.canonical)
  await writeThreadSurfaceState(fixture.canonical, {
    ...current, threadSurfaces: current.threadSurfaces.map(surface => surface.id === sealed.id
      ? { ...surface, revealState: 'revealed' as const } : surface),
  })
  expect((await detail()).status).toBe(200)
}, 60_000)

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import type { PackState } from '@/lib/packs/repository'

/**
 * Smoke tests for GET /api/packs (file-backed).
 */

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'packs-route-test-'))
  const stateDir = join(tempDir, '.threados', 'state')
  await mkdir(stateDir, { recursive: true })
  const emptyState: PackState = { version: 1, packs: [] }
  await writeFile(join(stateDir, 'packs.json'), JSON.stringify(emptyState, null, 2))
  process.env.THREADOS_BASE_PATH = tempDir
})

afterEach(async () => {
  delete process.env.THREADOS_BASE_PATH
  await rm(tempDir, { recursive: true, force: true })
})

const { GET } = await import('@/app/api/packs/route')

describe('GET /api/packs', () => {
  test('returns packs list as array', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.packs)).toBe(true)
  })

  test('returns JSON content type', async () => {
    const res = await GET()
    expect(res.headers.get('content-type')).toContain('application/json')
  })
})

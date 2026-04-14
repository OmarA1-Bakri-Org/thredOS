import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'child_process'

function runIsolatedRouteCheck(script: string) {
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Subprocess exited with code ${result.status}`)
  }

  return JSON.parse(result.stdout.trim()) as { status: number; body: Record<string, unknown> }
}

describe.serial('conflict route handling', () => {
  test('sequence conflict returns 409 from sequence POST', () => {
    const result = runIsolatedRouteCheck(`
      import { mock } from 'bun:test'
      import { ThredOSError } from './lib/errors'

      mock.module('@/lib/sequence/parser', () => ({
        readSequence: async () => ({ version: '1.0', name: 'conflict-seq', steps: [], gates: [] }),
        writeSequence: async () => {
          throw new ThredOSError(
            'Sequence was modified concurrently. Reload the latest workflow state and retry your change.',
            'SEQUENCE_CONFLICT',
          )
        },
      }))
      mock.module('@/lib/library/repository', () => ({
        ensureLibraryStructure: async () => {},
        ensurePromptAssetForStep: async () => ({ id: 'unused', version: 1, path: '.threados/prompts/unused.md' }),
        deleteLibraryAsset: async () => false,
      }))

      const { POST } = await import('./app/api/sequence/route.ts?sequence-conflict-subprocess')
      const response = await POST(new Request('http://localhost/api/sequence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rename', name: 'renamed' }),
      }))
      console.log(JSON.stringify({ status: response.status, body: await response.json() }))
    `)

    expect(result.status).toBe(409)
    expect(result.body).toMatchObject({ code: 'SEQUENCE_CONFLICT' })
  })

  test('thread-surface conflict returns 409 from sequence reset', () => {
    const result = runIsolatedRouteCheck(`
      import { mock } from 'bun:test'
      import { ThreadSurfaceStateConflictError } from './lib/errors'

      let surfaceWriteCount = 0
      mock.module('@/lib/sequence/parser', () => ({
        readSequence: async () => ({ version: '1.0', name: 'existing-seq', steps: [], gates: [] }),
        writeSequence: async () => {},
      }))
      mock.module('@/lib/thread-surfaces/repository', () => ({
        readThreadSurfaceState: async () => ({
          version: 1,
          threadSurfaces: [],
          runs: [],
          mergeEvents: [],
          runEvents: [],
        }),
        withThreadSurfaceStateRevision: (_current: unknown, next: unknown) => next,
        writeThreadSurfaceState: async () => {
          surfaceWriteCount += 1
          if (surfaceWriteCount === 1) {
            throw new ThreadSurfaceStateConflictError()
          }
        },
      }))
      mock.module('@/lib/library/repository', () => ({
        ensureLibraryStructure: async () => {},
        ensurePromptAssetForStep: async () => ({ id: 'unused', version: 1, path: '.threados/prompts/unused.md' }),
        deleteLibraryAsset: async () => false,
      }))
      mock.module('@/lib/thread-surfaces/materializer', () => ({
        clearAllSurfaces: () => ({ version: 1, threadSurfaces: [], runs: [], mergeEvents: [], runEvents: [] }),
        materializeBulkStepSurfaces: (state: unknown) => state,
      }))
      mock.module('@/lib/prompts/manager', () => ({
        deletePrompt: async () => {},
        writePrompt: async () => {},
      }))

      const { POST } = await import('./app/api/sequence/route.ts?surface-conflict-subprocess')
      const response = await POST(new Request('http://localhost/api/sequence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset', name: 'Reset Name' }),
      }))
      console.log(JSON.stringify({ status: response.status, body: await response.json() }))
    `)

    expect(result.status).toBe(409)
    expect(result.body).toMatchObject({ code: 'THREAD_SURFACE_STATE_CONFLICT' })
  })
})

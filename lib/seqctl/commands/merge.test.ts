import { afterEach, expect, test } from 'bun:test'
import type { MergePlan } from '../../merge/schema'
import { mergeCommand } from './merge'

const original = globalThis.__THREADOS_CLI_RUNTIME_SERVICE__
afterEach(() => { globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = original; process.exitCode = 0 })

test('CLI preview and validate call the shared runtime with explicit operator context', async () => {
  const calls: string[] = []
  const plan: MergePlan = { schema_version: 1, id: 'merge-1', status: 'ready', revision: 1,
    workflow_run_id: 'run-1', baseline_snapshot_id: 'baseline-1', change_set_ids: ['change-1'],
    canonical_precondition_hash: `sha256:${'b'.repeat(64)}`, preview_workspace_id: 'preview-1',
    conflicts: [], created_at: new Date().toISOString(), validated_at: null }
  globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = {
    previewSelectedChangeSet: async (id, context) => {
      calls.push(`preview:${id}:${context.interface}:${context.idempotencyKey}`)
      return { plan, preview_id: 'preview-1', preview_manifest: { schema_version: 1, snapshot_id: 'preview-1',
        root_manifest_hash: `sha256:${'a'.repeat(64)}`, entries: [] } }
    },
    validateMergePlan: async (id, context) => {
      calls.push(`validate:${id}:${context.interface}:${context.idempotencyKey}`)
      return { ...plan, status: 'validated' }
    },
  }
  const logged: string[] = []
  const priorLog = console.log
  console.log = value => { logged.push(String(value)) }
  try {
    const options = { json: true, help: false, watch: false, idempotencyKey: 'once' }
    await mergeCommand('preview', ['change-1'], options)
    await mergeCommand('validate', ['merge-1'], options)
  } finally { console.log = priorLog }
  expect(calls).toEqual(['preview:change-1:cli:once', 'validate:merge-1:cli:once'])
  expect(logged.every(value => JSON.parse(value).data.schema_version === 1)).toBe(true)
})

test('CLI inspect reports a missing merge plan with the not-found exit code', async () => {
  globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = { inspectMergePlan: async () => null }
  const lines: string[] = []
  const priorLog = console.log
  console.log = value => { lines.push(String(value)) }
  try { await mergeCommand('inspect', ['missing'], { json: true, help: false, watch: false }) }
  finally { console.log = priorLog }
  expect(process.exitCode).toBe(4)
  expect(JSON.parse(lines[0]!).error.code).toBe('MERGE_PLAN_NOT_FOUND')
})

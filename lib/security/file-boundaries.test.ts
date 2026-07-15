import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { access, mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { appendApproval, readApprovals } from '@/lib/approvals/repository'
import { generateExportBundle } from '@/lib/exports/bundler'
import { appendGateDecision, readGateDecisions } from '@/lib/gates/repository'
import { deleteLibraryAsset, readLibraryAsset, upsertLibraryAsset } from '@/lib/library/repository'
import { loadPack } from '@/lib/packs/loader'
import { deletePrompt, readPrompt, writePrompt } from '@/lib/prompts/manager'
import { createRunDirectory, writeRunRecord } from '@/lib/runner/artifacts'
import { provisionChildSequence } from '@/lib/thread-surfaces/provision-child-sequence'
import { writeThreadSurfaceState } from '@/lib/thread-surfaces/repository'
import { readTraceEvents } from '@/lib/traces/reader'
import { appendTraceEvent } from '@/lib/traces/writer'
import type { Approval, GateDecision, TraceEvent } from '@/lib/contracts/schemas'

const approval: Approval = {
  id: 'approval-1', action_type: 'run', target_ref: 'step-a', requested_by: 'tester',
  status: 'pending', approved_by: null, approved_at: null, notes: null,
}

const traceEvent: TraceEvent = {
  ts: '2026-07-16T00:00:00.000Z', run_id: 'run-1', surface_id: 'surface-1',
  actor: 'tester', event_type: 'step-started', payload_ref: null, policy_ref: null,
}

const gateDecision: GateDecision = {
  id: 'decision-1', subject_type: 'step', subject_ref: 'step-a', gate_type: 'policy_pass',
  status: 'PASS', reason_codes: [], evidence_refs: [], decided_by: 'threados',
  decided_at: '2026-07-16T00:00:00.000Z',
}

describe('file-backed boundary containment', () => {
  let testRoot: string
  let basePath: string
  let outside: string

  beforeEach(async () => {
    testRoot = await mkdtemp(join(tmpdir(), 'thredos-boundaries-'))
    basePath = join(testRoot, 'project')
    outside = join(testRoot, 'outside')
    await Promise.all([mkdir(basePath), mkdir(outside)])
  })

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true })
  })

  test('library asset IDs cannot escape their kind root', async () => {
    const unsafeId = '../../../outside/library-pwn'
    await expect(upsertLibraryAsset(basePath, {
      kind: 'prompt', id: unsafeId, title: 'unsafe', content: 'pwned',
    })).rejects.toThrow()
    await expect(access(join(outside, 'library-pwn.md'))).rejects.toThrow()
  })

  test('tampered library catalog paths cannot read or delete an external file', async () => {
    await mkdir(join(basePath, '.threados'), { recursive: true })
    await writeFile(join(outside, 'secret.md'), 'outside secret')
    await writeFile(join(basePath, '.threados', 'library.yaml'), [
      'version: 1',
      'prompts:',
      '  poisoned:',
      '    id: poisoned',
      '    kind: prompt',
      '    title: Poisoned',
      '    version: 1',
      '    path: ../outside/secret.md',
      '    updatedAt: 2026-07-16T00:00:00.000Z',
      '    lastEditor: null',
      '    capabilities: []',
      '    links: { agentIds: [], nodeIds: [] }',
      'skills: {}',
      'agents: {}',
    ].join('\n'))

    await expect(readLibraryAsset(basePath, 'prompt', 'poisoned')).rejects.toThrow()
    await expect(deleteLibraryAsset(basePath, 'prompt', 'poisoned')).rejects.toThrow()
    expect(await Bun.file(join(outside, 'secret.md')).text()).toBe('outside secret')
  })

  test('prompt IDs cannot escape for read, write, or delete', async () => {
    const unsafeId = '../../../outside/prompt-pwn'
    await expect(writePrompt(basePath, unsafeId, 'pwned')).rejects.toThrow()
    await expect(readPrompt(basePath, unsafeId)).rejects.toThrow()
    await expect(deletePrompt(basePath, unsafeId)).rejects.toThrow()
    await expect(access(join(outside, 'prompt-pwn.md'))).rejects.toThrow()
  })

  test('pack ID and version cannot select a manifest outside the pack store', async () => {
    await writeFile(join(outside, 'pack.yaml'), [
      'id: outside', 'version: 1.0.0', 'name: Outside', 'thread_types: [base]',
      'default_policy: SAFE', 'agents: []', 'surface_classes: [shared]',
      'phases:', '  - { id: phase-a, label: Phase A, order: 0 }',
      'steps:',
      '  - id: step-a', '    name: Step A', '    type: base', '    model: test',
      '    phase: phase-a', '    surface_class: shared', '    depends_on: []',
      'gate_sets: []',
    ].join('\n'))
    await expect(loadPack(basePath, '../../../outside', '.')).rejects.toThrow()
  })

  test('pack manifests reject traversal-capable step IDs before installation writes', async () => {
    const packDir = join(basePath, '.threados', 'packs', 'unsafe-pack', '1.0.0')
    await mkdir(packDir, { recursive: true })
    await writeFile(join(packDir, 'pack.yaml'), [
      'id: unsafe-pack', 'version: 1.0.0', 'name: Unsafe Pack', 'thread_types: [base]',
      'default_policy: SAFE', 'agents: []', 'surface_classes: [shared]',
      'phases:', '  - { id: phase-a, label: Phase A, order: 0 }',
      'steps:',
      '  - id: ../../../outside/prompt-pwn', '    name: Unsafe Step', '    type: base',
      '    model: test', '    phase: phase-a', '    surface_class: shared', '    depends_on: []',
      'gate_sets: []',
    ].join('\n'))

    await expect(loadPack(basePath, 'unsafe-pack', '1.0.0')).rejects.toThrow()
    await expect(access(join(outside, 'prompt-pwn.md'))).rejects.toThrow()
  })

  test('run repositories reject traversal before reads or writes', async () => {
    const unsafeRunId = '../../../outside'
    await expect(appendApproval(basePath, unsafeRunId, approval)).rejects.toThrow()
    await expect(readApprovals(basePath, unsafeRunId)).rejects.toThrow()
    await expect(appendTraceEvent(basePath, unsafeRunId, traceEvent)).rejects.toThrow()
    await expect(readTraceEvents(basePath, unsafeRunId)).rejects.toThrow()
    await expect(appendGateDecision(basePath, unsafeRunId, gateDecision)).rejects.toThrow()
    await expect(readGateDecisions(basePath, unsafeRunId)).rejects.toThrow()
  })

  test('run artifact identifiers cannot escape the run store', async () => {
    await expect(createRunDirectory(basePath, '../../../outside', 'step-a')).rejects.toThrow()
    await expect(writeRunRecord(basePath, {
      id: '..', sequence_id: 'sequence-a', step_id: 'step-a', surface_id: 'surface-a',
      attempt: 1, status: 'pending', executor: 'tester', model: 'test',
      policy_snapshot_hash: 'hash', compiled_prompt_hash: 'hash', input_manifest_ref: null,
      artifact_manifest_ref: null, started_at: '2026-07-16T00:00:00.000Z', ended_at: null,
      timing_summary: null, cost_summary: null,
    })).rejects.toThrow()
  })

  test('surface IDs cannot escape canonical surface records', async () => {
    await expect(writeThreadSurfaceState(basePath, {
      version: 1,
      threadSurfaces: [{
        id: '../../../outside', parentSurfaceId: null, parentAgentNodeId: null, depth: 0,
        surfaceLabel: 'Unsafe', createdAt: '2026-07-16T00:00:00.000Z', childSurfaceIds: [],
        sequenceRef: null, spawnedByAgentId: null, surfaceClass: 'shared', visibility: 'dependency',
        isolationLabel: 'NONE', revealState: null, allowedReadScopes: [], allowedWriteScopes: [],
      }],
      runs: [], mergeEvents: [], runEvents: [],
    })).rejects.toThrow()
  })

  test('child sequence provisioning rejects an unsafe ID or mismatched path ref', async () => {
    await expect(provisionChildSequence(basePath, {
      surfaceId: '../../../outside', sequenceRef: '../../../outside/sequence.yaml',
      sequenceName: 'Unsafe', threadType: 'base',
    })).rejects.toThrow()
    await expect(provisionChildSequence(basePath, {
      surfaceId: 'surface-a', sequenceRef: '../outside/sequence.yaml',
      sequenceName: 'Unsafe', threadType: 'base',
    })).rejects.toThrow()
  })

  test('export bundling rejects dot-segment run IDs', async () => {
    await expect(generateExportBundle(basePath, '.')).rejects.toThrow()
    await expect(generateExportBundle(basePath, '..')).rejects.toThrow()
  })
})

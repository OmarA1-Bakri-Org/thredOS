import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  appendPlanRevision,
  getRuntimePlanPath,
  initRuntimePlan,
  readRuntimePlan,
  writeRuntimePlan,
} from './plan'

let basePath = ''

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), 'threados-runtime-plan-'))
})

afterEach(async () => {
  await rm(basePath, { recursive: true, force: true })
})

describe('runtime plan persistence', () => {
  test('initializes a runtime plan with deterministic mission fields', async () => {
    const plan = await initRuntimePlan(basePath, {
      mission_id: 'seq-123',
      goal: 'Revise discovery strategy when sparse',
      candidate_strategies: ['standard-discovery', 'broaden-discovery'],
      selected_strategy: 'standard-discovery',
    })

    expect(plan.mission_id).toBe('seq-123')
    expect(plan.goal).toBe('Revise discovery strategy when sparse')
    expect(plan.status).toBe('active')
    expect(plan.selected_strategy).toBe('standard-discovery')
    expect(plan.candidate_strategies).toEqual(['standard-discovery', 'broaden-discovery'])
    expect(plan.revisions).toEqual([])

    const raw = await readFile(getRuntimePlanPath(basePath), 'utf-8')
    expect(raw).toContain('standard-discovery')
  })

  test('writes and reads a runtime plan atomically', async () => {
    await mkdir(join(basePath, '.threados', 'state'), { recursive: true })
    const plan = {
      mission_id: 'seq-abc',
      goal: 'Test plan persistence',
      status: 'active' as const,
      selected_strategy: 'standard-discovery',
      candidate_strategies: ['standard-discovery'],
      revisions: [],
      created_at: '2026-04-22T00:00:00.000Z',
      updated_at: '2026-04-22T00:00:00.000Z',
    }

    await writeRuntimePlan(basePath, plan)
    const loaded = await readRuntimePlan(basePath)

    expect(loaded).toEqual(plan)
  })

  test('returns null when runtime plan file does not exist', async () => {
    await expect(readRuntimePlan(basePath)).resolves.toBeNull()
  })

  test('rejects malformed runtime plan json', async () => {
    const path = getRuntimePlanPath(basePath)
    await mkdir(join(basePath, '.threados', 'state'), { recursive: true })
    await writeFile(path, '{not-json', 'utf-8')

    await expect(readRuntimePlan(basePath)).rejects.toThrow()
  })

  test('appends a revision and updates updated_at', async () => {
    const plan = await initRuntimePlan(basePath, {
      mission_id: 'seq-xyz',
      goal: 'Replan discovery',
      candidate_strategies: ['standard-discovery', 'broaden-discovery'],
      selected_strategy: 'standard-discovery',
    })

    const updated = await appendPlanRevision(basePath, {
      revision_id: 'rev-001',
      ts: '2026-04-22T00:10:00.000Z',
      from_strategy: 'standard-discovery',
      to_strategy: 'broaden-discovery',
      reason: 'prospects=0',
      approval_required: true,
      approved: false,
    })

    expect(updated.revisions).toHaveLength(1)
    expect(updated.revisions[0]).toEqual({
      revision_id: 'rev-001',
      ts: '2026-04-22T00:10:00.000Z',
      from_strategy: 'standard-discovery',
      to_strategy: 'broaden-discovery',
      reason: 'prospects=0',
      approval_required: true,
      approved: false,
    })
    expect(updated.updated_at).not.toBe(plan.updated_at)
  })
})

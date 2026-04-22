import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { createTempDir, cleanTempDir } from '../../test/helpers/setup'
import { appendApproval, hasApprovedApproval, readApprovals } from './repository'
import type { Approval } from '@/lib/contracts/schemas'

function makeApproval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: 'approval-1',
    action_type: 'run',
    target_ref: 'step/build',
    requested_by: 'agent-alpha',
    status: 'pending',
    approved_by: null,
    approved_at: null,
    notes: null,
    ...overrides,
  }
}

describe('approval repository', () => {
  let tmpDir: string
  const runId = 'run-abc123'

  beforeEach(async () => {
    tmpDir = await createTempDir()
  })

  afterEach(async () => {
    await cleanTempDir(tmpDir)
  })

  test('append and read a single approval — all fields persist correctly', async () => {
    const approval = makeApproval({
      id: 'approval-x1',
      action_type: 'reveal',
      target_ref: 'surface/shared',
      requested_by: 'agent-beta',
      status: 'approved',
      approved_by: 'human-reviewer',
      approved_at: '2026-03-28T10:00:00.000Z',
      notes: 'Looks good',
    })

    await appendApproval(tmpDir, runId, approval)
    const results = await readApprovals(tmpDir, runId)

    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('approval-x1')
    expect(results[0].action_type).toBe('reveal')
    expect(results[0].target_ref).toBe('surface/shared')
    expect(results[0].requested_by).toBe('agent-beta')
    expect(results[0].status).toBe('approved')
    expect(results[0].approved_by).toBe('human-reviewer')
    expect(results[0].approved_at).toBe('2026-03-28T10:00:00.000Z')
    expect(results[0].notes).toBe('Looks good')
  })

  test('returns empty array when approvals file does not exist', async () => {
    const results = await readApprovals(tmpDir, 'nonexistent-run')
    expect(results).toEqual([])
  })

  test('append multiple approvals and read them all back in order', async () => {
    const a1 = makeApproval({ id: 'approval-1', action_type: 'run', status: 'pending' })
    const a2 = makeApproval({ id: 'approval-2', action_type: 'side_effect', status: 'approved', approved_by: 'admin', approved_at: '2026-03-28T11:00:00.000Z' })
    const a3 = makeApproval({ id: 'approval-3', action_type: 'gate_override', status: 'rejected' })

    await appendApproval(tmpDir, runId, a1)
    await appendApproval(tmpDir, runId, a2)
    await appendApproval(tmpDir, runId, a3)

    const results = await readApprovals(tmpDir, runId)

    expect(results).toHaveLength(3)
    expect(results[0].id).toBe('approval-1')
    expect(results[0].action_type).toBe('run')
    expect(results[1].id).toBe('approval-2')
    expect(results[1].action_type).toBe('side_effect')
    expect(results[1].approved_by).toBe('admin')
    expect(results[2].id).toBe('approval-3')
    expect(results[2].status).toBe('rejected')
  })

  test('hasApprovedApproval reuses approved records across runs after folding repeated ids', async () => {
    await appendApproval(tmpDir, 'run-1', makeApproval({
      id: 'approval-shared',
      target_ref: 'step:review',
      status: 'pending',
    }))
    await appendApproval(tmpDir, 'run-1', makeApproval({
      id: 'approval-shared',
      target_ref: 'step:review',
      status: 'approved',
      approved_by: 'human-reviewer',
      approved_at: '2026-03-28T12:00:00.000Z',
    }))
    await appendApproval(tmpDir, 'run-2', makeApproval({
      id: 'approval-other',
      target_ref: 'step:other',
      status: 'pending',
    }))

    await expect(hasApprovedApproval(tmpDir, 'step:review')).resolves.toBe(true)
    await expect(hasApprovedApproval(tmpDir, 'step:other')).resolves.toBe(false)
    await expect(hasApprovedApproval(tmpDir, 'step:missing')).resolves.toBe(false)
  })

  test('rejects traversal-like run ids', async () => {
    await expect(appendApproval(tmpDir, '../escape', makeApproval())).rejects.toThrow('single path segment')
  })
})

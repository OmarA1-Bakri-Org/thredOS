import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import {
  setAtomicBeforeRenameHookForTests,
  withExclusiveFileLock,
} from '@/lib/fs/atomic'
import { createTempDir, cleanTempDir } from '../../test/helpers/setup'
import {
  appendApproval,
  appendApprovalLifecycle,
  ApprovalConsumptionError,
  ApprovalResolutionError,
  consumeApproval,
  readApprovals,
  resolvePendingApproval,
} from './repository'
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
    setAtomicBeforeRenameHookForTests(null)
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

  test('concurrent resolves have exactly one winner and persist one terminal record', async () => {
    const pending = makeApproval({
      id: 'approval-concurrent',
      status: 'pending',
      subject_digest: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      payload_ref: 'payloads/run-build.json',
      policy_ref: 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
    })
    await appendApproval(tmpDir, runId, pending)

    const attempts = await Promise.allSettled([
      resolvePendingApproval(tmpDir, runId, pending.id, current => ({
        ...current,
        status: 'approved',
        approved_by: 'reviewer-a@example.com',
        approved_at: '2026-08-28T10:00:00.000Z',
        notes: 'approved by reviewer a',
      })),
      resolvePendingApproval(tmpDir, runId, pending.id, current => ({
        ...current,
        status: 'approved',
        approved_by: 'reviewer-b@example.com',
        approved_at: '2026-08-28T10:00:01.000Z',
        notes: 'approved by reviewer b',
      })),
    ])

    expect(attempts.filter(attempt => attempt.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter(attempt => attempt.status === 'rejected')).toHaveLength(1)
    const rejected = attempts.find(attempt => attempt.status === 'rejected')
    expect(rejected?.reason).toBeInstanceOf(ApprovalResolutionError)
    expect((rejected?.reason as ApprovalResolutionError).code).toBe('APPROVAL_ALREADY_RESOLVED')

    const results = await readApprovals(tmpDir, runId)
    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({ id: 'approval-concurrent', status: 'pending' })
    expect(results[1]).toMatchObject({ id: 'approval-concurrent', status: 'approved' })
  })

  test('concurrent lifecycle appends have exactly one winner and write one pending-approved pair', async () => {
    const pending = makeApproval({
      id: 'approval-lifecycle',
      status: 'pending',
      subject_digest: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      payload_ref: 'payloads/run-build.json',
      policy_ref: 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
    })

    const attempts = await Promise.allSettled([
      appendApprovalLifecycle(tmpDir, runId, pending, {
        ...pending,
        status: 'approved',
        approved_by: 'reviewer-a@example.com',
        approved_at: '2026-08-28T10:00:00.000Z',
        notes: 'approved by reviewer a',
      }),
      appendApprovalLifecycle(tmpDir, runId, pending, {
        ...pending,
        status: 'approved',
        approved_by: 'reviewer-b@example.com',
        approved_at: '2026-08-28T10:00:01.000Z',
        notes: 'approved by reviewer b',
      }),
    ])

    expect(attempts.filter(attempt => attempt.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter(attempt => attempt.status === 'rejected')).toHaveLength(1)
    const rejected = attempts.find(attempt => attempt.status === 'rejected')
    expect(rejected?.reason).toBeInstanceOf(ApprovalResolutionError)
    expect((rejected?.reason as ApprovalResolutionError).code).toBe('APPROVAL_ALREADY_EXISTS')

    const results = await readApprovals(tmpDir, runId)
    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({ id: 'approval-lifecycle', status: 'pending' })
    expect(results[1]).toMatchObject({ id: 'approval-lifecycle', status: 'approved' })
  })

  test('concurrent approval consumption has exactly one winner and appends one consumed record', async () => {
    const approved = makeApproval({
      id: 'approval-consume-concurrent',
      status: 'approved',
      approved_by: 'reviewer@example.com',
      approved_at: '2026-08-28T10:00:00.000Z',
      target_ref: 'step:build',
      subject_digest: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      payload_ref: 'payloads/run-build.json',
      policy_ref: 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      consumed_at: null,
      consumed_by: null,
    })
    await appendApproval(tmpDir, runId, approved)

    const attempts = await Promise.allSettled([
      consumeApproval(tmpDir, runId, approved.id, {
        targetRefs: ['step:build'],
        subjectDigest: approved.subject_digest!,
        consumedAt: '2026-08-28T10:01:00.000Z',
        consumedBy: 'runtime:system',
      }),
      consumeApproval(tmpDir, runId, approved.id, {
        targetRefs: ['step:build'],
        subjectDigest: approved.subject_digest!,
        consumedAt: '2026-08-28T10:01:01.000Z',
        consumedBy: 'runtime:api',
      }),
    ])

    expect(attempts.filter(attempt => attempt.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter(attempt => attempt.status === 'rejected')).toHaveLength(1)
    const rejected = attempts.find(attempt => attempt.status === 'rejected')
    expect(rejected?.reason).toBeInstanceOf(ApprovalConsumptionError)
    expect((rejected?.reason as ApprovalConsumptionError).code).toBe('APPROVAL_ALREADY_CONSUMED')

    const results = await readApprovals(tmpDir, runId)
    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({ id: approved.id, status: 'approved', consumed_at: null })
    expect(results[1]).toMatchObject({
      id: approved.id,
      status: 'approved',
      consumed_at: expect.any(String),
      consumed_by: expect.stringMatching(/^runtime:/),
    })
  })

  test('approval consumption fails closed for mismatched, expired, and unbound approvals', async () => {
    const mismatch = makeApproval({
      id: 'approval-consume-mismatch',
      status: 'approved',
      approved_by: 'reviewer@example.com',
      approved_at: '2026-08-28T10:00:00.000Z',
      target_ref: 'step:build',
      subject_digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      payload_ref: 'payloads/run-build.json',
      policy_ref: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      consumed_at: null,
      consumed_by: null,
    })
    await appendApproval(tmpDir, runId, mismatch)
    await expect(consumeApproval(tmpDir, runId, mismatch.id, {
      targetRefs: ['step:build'],
      subjectDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      consumedAt: '2026-08-28T10:01:00.000Z',
      consumedBy: 'runtime:system',
    })).rejects.toMatchObject({
      name: 'ApprovalConsumptionError',
      code: 'APPROVAL_BINDING_MISMATCH',
    })

    const expired = makeApproval({
      id: 'approval-consume-expired',
      status: 'approved',
      approved_by: 'reviewer@example.com',
      approved_at: '2026-08-28T10:00:00.000Z',
      target_ref: 'step:build',
      subject_digest: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      payload_ref: 'payloads/run-build.json',
      policy_ref: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      expires_at: '2026-08-27T10:00:00.000Z',
      consumed_at: null,
      consumed_by: null,
    })
    await appendApproval(tmpDir, runId, expired)
    await expect(consumeApproval(tmpDir, runId, expired.id, {
      targetRefs: ['step:build'],
      subjectDigest: expired.subject_digest!,
      consumedAt: '2026-08-28T10:01:00.000Z',
      consumedBy: 'runtime:system',
    })).rejects.toMatchObject({
      name: 'ApprovalConsumptionError',
      code: 'APPROVAL_EXPIRED',
    })

    const unbound = makeApproval({
      id: 'approval-consume-unbound',
      status: 'approved',
      approved_by: 'reviewer@example.com',
      approved_at: '2026-08-28T10:00:00.000Z',
      target_ref: 'step:build',
      consumed_at: null,
      consumed_by: null,
    })
    await appendApproval(tmpDir, runId, unbound)
    await expect(consumeApproval(tmpDir, runId, unbound.id, {
      targetRefs: ['step:build'],
      subjectDigest: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      consumedAt: '2026-08-28T10:01:00.000Z',
      consumedBy: 'runtime:system',
    })).rejects.toMatchObject({
      name: 'ApprovalConsumptionError',
      code: 'APPROVAL_BINDING_MISMATCH',
    })
  })

  test('readApprovals waits for the per-run lock and never parses partial NDJSON writes', async () => {
    const runDir = join(tmpDir, '.threados', 'runs', runId)
    await mkdir(runDir, { recursive: true })
    const approvalsPath = join(runDir, 'approvals.ndjson')
    const lockPath = join(runDir, 'approvals.ndjson.lock')

    let readPromise: Promise<Approval[]> | null = null

    await withExclusiveFileLock(lockPath, async () => {
      await writeFile(approvalsPath, '{"id":"partial"', 'utf-8')
      readPromise = readApprovals(tmpDir, runId)
      await new Promise(resolve => setTimeout(resolve, 20))
      await writeFile(approvalsPath, `${JSON.stringify(makeApproval({
        id: 'approval-complete',
        subject_digest: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        payload_ref: 'payloads/run-build.json',
        policy_ref: 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      }))}\n`, 'utf-8')
    }, { allowedRoot: tmpDir })

    await expect(readPromise!).resolves.toEqual([
      expect.objectContaining({ id: 'approval-complete' }),
    ])
  })

  test('injected atomic lifecycle write failure preserves prior bytes and retry succeeds without orphan pending state', async () => {
    const stableApproval = makeApproval({
      id: 'approval-stable',
      status: 'approved',
      approved_by: 'reviewer@example.com',
      approved_at: '2026-08-28T10:00:00.000Z',
      subject_digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      payload_ref: 'payloads/stable.json',
      policy_ref: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    })
    await appendApproval(tmpDir, runId, stableApproval)

    const runDir = join(tmpDir, '.threados', 'runs', runId)
    const approvalsPath = join(runDir, 'approvals.ndjson')
    const before = await readFile(approvalsPath, 'utf-8')
    const pending = makeApproval({
      id: 'approval-atomic-failure',
      status: 'pending',
      subject_digest: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      payload_ref: 'payloads/run-build.json',
      policy_ref: 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
    })

    setAtomicBeforeRenameHookForTests(async target => {
      if (target === approvalsPath) throw new Error('injected approvals rename failure')
    })

    await expect(appendApprovalLifecycle(tmpDir, runId, pending, {
      ...pending,
      status: 'approved',
      approved_by: 'reviewer@example.com',
      approved_at: '2026-08-28T10:00:01.000Z',
    })).rejects.toThrow('injected approvals rename failure')

    expect(await readFile(approvalsPath, 'utf-8')).toBe(before)
    expect(await readApprovals(tmpDir, runId)).toEqual([stableApproval])
    expect((await readdir(runDir)).filter(name => name.endsWith('.tmp') || name.endsWith('.lock'))).toEqual([])

    setAtomicBeforeRenameHookForTests(null)

    await expect(appendApprovalLifecycle(tmpDir, runId, pending, {
      ...pending,
      status: 'approved',
      approved_by: 'reviewer@example.com',
      approved_at: '2026-08-28T10:00:01.000Z',
    })).resolves.toMatchObject({
      id: 'approval-atomic-failure',
      status: 'approved',
    })

    const results = await readApprovals(tmpDir, runId)
    expect(results.map(entry => entry.id)).toEqual([
      'approval-stable',
      'approval-atomic-failure',
      'approval-atomic-failure',
    ])
    expect(results.filter(entry => entry.id === 'approval-atomic-failure' && entry.status === 'pending')).toHaveLength(1)
    expect(results.filter(entry => entry.id === 'approval-atomic-failure' && entry.status === 'approved')).toHaveLength(1)
  })
})

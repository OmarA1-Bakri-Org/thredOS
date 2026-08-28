import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { readApprovals } from '@/lib/approvals/repository'
import { readTraceEvents } from '@/lib/traces/reader'
import { cleanTempDir, createTempDir } from '../../test/helpers/setup'
import {
  recordApprovedApprovalLifecycle,
  recordConsumedApprovalLifecycle,
  setApprovalTraceAppenderForTests,
} from './runtime'
import { setAtomicBeforeRenameHookForTests } from '@/lib/fs/atomic'

let tmpDir: string

describe.serial('recordApprovedApprovalLifecycle', () => {
  beforeEach(async () => {
    tmpDir = await createTempDir()
  })

  afterEach(async () => {
    setApprovalTraceAppenderForTests(null)
    setAtomicBeforeRenameHookForTests(null)
    await cleanTempDir(tmpDir)
  })

  test('persists exact binding evidence on pending and approved approvals with consumed fields left null and reuses it in traces', async () => {
    const result = await recordApprovedApprovalLifecycle({
      basePath: tmpDir,
      runId: 'run-binding',
      actionType: 'run',
      targetRef: 'step:build',
      requestedBy: 'agent-alpha',
      resolvedBy: 'reviewer@example.com',
      actor: 'runtime:test',
      notes: 'Confirmed exact binding.',
      payloadRef: 'payloads/run-binding.json',
      policyRef: 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      subjectDigest: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      preconditionHash: 'sha256:00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
      expiresAt: '2026-08-28T12:00:00.000Z',
    })

    expect(result).toMatchObject({
      commit_status: 'committed',
      trace_status: 'persisted',
    })
    expect(result.approval).toMatchObject({
      status: 'approved',
      payload_ref: 'payloads/run-binding.json',
      policy_ref: 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      subject_digest: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      precondition_hash: 'sha256:00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
      expires_at: '2026-08-28T12:00:00.000Z',
      consumed_at: null,
      consumed_by: null,
    })

    const approvals = await readApprovals(tmpDir, 'run-binding')
    expect(approvals).toHaveLength(2)
    expect(approvals[0]).toMatchObject({
      status: 'pending',
      payload_ref: 'payloads/run-binding.json',
      policy_ref: 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      subject_digest: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      precondition_hash: 'sha256:00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
      expires_at: '2026-08-28T12:00:00.000Z',
      consumed_at: null,
      consumed_by: null,
    })
    expect(approvals[1]).toMatchObject({
      status: 'approved',
      payload_ref: 'payloads/run-binding.json',
      policy_ref: 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
    })

    const traces = await readTraceEvents(tmpDir, 'run-binding')
    expect(traces.map(trace => trace.event_type)).toEqual(['approval-requested', 'approval-resolved'])
    expect(traces[0]).toMatchObject({
      payload_ref: 'payloads/run-binding.json',
      policy_ref: 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
    })
    expect(traces[1]).toMatchObject({
      payload_ref: 'payloads/run-binding.json',
      policy_ref: 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
    })
  })

  test('rejects unbound runtime-affecting approval lifecycle writes', async () => {
    await expect(recordApprovedApprovalLifecycle({
      basePath: tmpDir,
      runId: 'run-unbound-binding',
      actionType: 'side_effect',
      targetRef: 'chat-apply:surface:1',
      requestedBy: 'local@thredos',
      resolvedBy: 'local@thredos',
      actor: 'runtime:test',
      notes: 'Should fail without exact binding.',
    })).rejects.toThrow('Runtime approvals require subject_digest, payload_ref, and policy_ref')
  })

  test('committed lifecycle returns failed trace evidence instead of throwing when trace append fails', async () => {
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
    setApprovalTraceAppenderForTests(async () => {
      throw new Error('disk full')
    })

    const result = await recordApprovedApprovalLifecycle({
      basePath: tmpDir,
      runId: 'run-trace-failure',
      actionType: 'run',
      targetRef: 'step:build',
      requestedBy: 'agent-alpha',
      resolvedBy: 'reviewer@example.com',
      actor: 'runtime:test',
      payloadRef: 'payloads/run-binding.json',
      policyRef: 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      subjectDigest: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    })

    expect(result).toMatchObject({
      commit_status: 'committed',
      trace_status: 'failed',
      warning_code: 'APPROVAL_TRACE_PERSIST_FAILED',
      warning: 'Approval committed, but approval trace projection persistence failed.',
    })
    expect(result.warning).not.toContain('disk full')
    expect(errorSpy).toHaveBeenCalled()
    expect((await readApprovals(tmpDir, 'run-trace-failure')).map(approval => approval.status)).toEqual([
      'pending',
      'approved',
    ])
    await expect(readTraceEvents(tmpDir, 'run-trace-failure')).resolves.toEqual([])
    errorSpy.mockRestore()
  })

  test('recordConsumedApprovalLifecycle persists pending, approved, and consumed entries in one committed lifecycle', async () => {
    const result = await recordConsumedApprovalLifecycle({
      basePath: tmpDir,
      runId: 'run-consumed-binding',
      actionType: 'run',
      targetRef: 'step:build',
      requestedBy: 'agent-alpha',
      resolvedBy: 'reviewer@example.com',
      consumedBy: 'runtime:test',
      actor: 'runtime:test',
      notes: 'Confirmed and consumed exact binding.',
      payloadRef: 'payloads/run-binding.json',
      policyRef: 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      subjectDigest: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      preconditionHash: 'sha256:00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
      expiresAt: '2026-08-28T12:00:00.000Z',
    })

    expect(result.approval).toMatchObject({
      status: 'approved',
      consumed_at: expect.any(String),
      consumed_by: 'runtime:test',
    })
    const approvals = await readApprovals(tmpDir, 'run-consumed-binding')
    expect(approvals.map(approval => approval.status)).toEqual(['pending', 'approved', 'approved'])
    expect(approvals[1]).toMatchObject({ consumed_at: null, consumed_by: null })
    expect(approvals[2]).toMatchObject({
      consumed_at: expect.any(String),
      consumed_by: 'runtime:test',
      subject_digest: approvals[1].subject_digest,
    })
  })

  test('recordConsumedApprovalLifecycle atomic failure leaves no approval residue', async () => {
    setAtomicBeforeRenameHookForTests(async target => {
      if (target.endsWith('approvals.ndjson')) throw new Error('injected approvals rename failure')
    })

    await expect(recordConsumedApprovalLifecycle({
      basePath: tmpDir,
      runId: 'run-consumed-failure',
      actionType: 'run',
      targetRef: 'step:build',
      requestedBy: 'agent-alpha',
      resolvedBy: 'reviewer@example.com',
      consumedBy: 'runtime:test',
      actor: 'runtime:test',
      payloadRef: 'payloads/run-binding.json',
      policyRef: 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      subjectDigest: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    })).rejects.toThrow('injected approvals rename failure')

    await expect(readApprovals(tmpDir, 'run-consumed-failure')).resolves.toEqual([])
    await expect(readTraceEvents(tmpDir, 'run-consumed-failure')).resolves.toEqual([])
  })
})

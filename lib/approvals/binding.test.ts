import { describe, expect, test } from 'bun:test'
import type { Approval } from '@/lib/contracts/schemas'
import {
  assertRuntimeApprovalBinding,
  classifyApprovalBinding,
  getApprovalBindingStatus,
  hasExactApprovalBinding,
  isApprovalExpired,
  projectApprovalForPublic,
} from './binding'

function makeApproval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: 'apr-1',
    action_type: 'run',
    target_ref: 'step:build',
    requested_by: 'agent-alpha',
    status: 'approved',
    approved_by: 'reviewer@example.com',
    approved_at: '2026-08-28T09:00:00.000Z',
    notes: null,
    subject_digest: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    payload_ref: 'payloads/run-1.json',
    policy_ref: 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
    precondition_hash: null,
    expires_at: null,
    consumed_at: null,
    consumed_by: null,
    ...overrides,
  }
}

describe('approval binding helper', () => {
  test('detects exact and unbound approval bindings from persisted fields', () => {
    expect(hasExactApprovalBinding(makeApproval())).toBe(true)
    expect(getApprovalBindingStatus(makeApproval())).toBe('exact')
    expect(hasExactApprovalBinding(makeApproval({
      payload_ref: null,
    }))).toBe(false)
    expect(getApprovalBindingStatus(makeApproval({
      payload_ref: null,
    }))).toBe('unbound')
  })

  test('classifies approved runtime approvals with exact binding as execution-authoritative', () => {
    expect(classifyApprovalBinding(makeApproval(), new Date('2026-08-28T10:00:00.000Z'))).toEqual({
      binding_status: 'exact',
      authoritative_for_execution: true,
    })
  })

  test('classifies reveal approvals without exact binding as unbound and non-authoritative', () => {
    expect(classifyApprovalBinding(makeApproval({
      action_type: 'reveal',
      target_ref: 'surface/shared',
      subject_digest: null,
      payload_ref: null,
      policy_ref: null,
    }), new Date('2026-08-28T10:00:00.000Z'))).toEqual({
      binding_status: 'unbound',
      authoritative_for_execution: false,
    })
  })

  test('expired or consumed exact approvals are not execution-authoritative', () => {
    expect(classifyApprovalBinding(makeApproval({
      expires_at: '2026-08-28T09:30:00.000Z',
    }), new Date('2026-08-28T10:00:00.000Z')).authoritative_for_execution).toBe(false)
    expect(isApprovalExpired(makeApproval({
      expires_at: '2026-08-28T09:30:00.000Z',
    }), new Date('2026-08-28T10:00:00.000Z'))).toBe(true)

    expect(classifyApprovalBinding(makeApproval({
      consumed_at: '2026-08-28T09:15:00.000Z',
    }), new Date('2026-08-28T10:00:00.000Z')).authoritative_for_execution).toBe(false)
  })

  test('requires exact binding fields for runtime-affecting approval requests', () => {
    expect(() => assertRuntimeApprovalBinding({
      actionType: 'run',
      subjectDigest: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      payloadRef: null,
      policyRef: 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
    })).toThrow('Runtime approvals require subject_digest, payload_ref, and policy_ref')
  })

  test('accepts exact binding fields for runtime-affecting approval resolves and allows unbound reveal approvals', () => {
    expect(() => assertRuntimeApprovalBinding({
      actionType: 'side_effect',
      subjectDigest: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      payloadRef: 'payloads/chat-apply.json',
      policyRef: 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      preconditionHash: 'sha256:00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
      expiresAt: '2026-08-28T12:00:00.000Z',
    })).not.toThrow()

    expect(() => assertRuntimeApprovalBinding({
      actionType: 'reveal',
      subjectDigest: null,
      payloadRef: null,
      policyRef: null,
    })).not.toThrow()
  })

  test('projects approvals for public reads and writes without mutating execution authority rules', () => {
    expect(projectApprovalForPublic(makeApproval({
      action_type: 'reveal',
      subject_digest: null,
      payload_ref: null,
      policy_ref: null,
    }), new Date('2026-08-28T10:00:00.000Z'))).toMatchObject({
      action_type: 'reveal',
      binding_status: 'unbound',
      authoritative_for_execution: false,
    })
  })
})

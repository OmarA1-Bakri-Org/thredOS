import { describe, expect, test } from 'bun:test'
import {
  approvalMatchesExecutableSubject,
  evaluateExecutablePayload,
  executableSubjectDigest,
} from './executable'
import { PolicyConfigSchema, type ExecutablePayload } from './schema'
import type { Approval } from '@/lib/contracts/schemas'

describe('executable policy binding', () => {
  test('approval for payload A cannot authorize changed payload B on the same step', () => {
    const policy = PolicyConfigSchema.parse({ mode: 'SAFE' })
    const payloadA: ExecutablePayload = {
      command: 'sh', args: [], cwd: '/workspace',
      script: { interpreter: 'sh', content: 'echo payload-a' },
    }
    const payloadB: ExecutablePayload = {
      ...payloadA,
      script: { interpreter: 'sh', content: 'echo payload-b' },
    }
    const digestA = executableSubjectDigest(payloadA, '/workspace', policy)
    const digestB = executableSubjectDigest(payloadB, '/workspace', policy)
    const approval: Approval = {
      id: 'approval-a', action_type: 'run', target_ref: 'step:same-step',
      requested_by: 'tester', status: 'approved', approved_by: 'tester',
      approved_at: '2026-07-16T00:00:00.000Z', notes: null,
      subject_digest: digestA,
      payload_ref: 'payloads/run-a.json',
      policy_ref: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      consumed_at: null,
    }

    expect(digestB).not.toBe(digestA)
    expect(approvalMatchesExecutableSubject(approval, ['step:same-step'], digestA)).toBe(true)
    expect(approvalMatchesExecutableSubject(approval, ['step:same-step'], digestB)).toBe(false)
  })

  test('expired, consumed, and unbound approvals do not authorize executable payloads', () => {
    const approval: Approval = {
      id: 'approval-b',
      action_type: 'run',
      target_ref: 'step:same-step',
      requested_by: 'tester',
      status: 'approved',
      approved_by: 'tester',
      approved_at: '2026-07-16T00:00:00.000Z',
      notes: null,
      subject_digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      payload_ref: 'payloads/run-b.json',
      policy_ref: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      consumed_at: null,
    }

    expect(approvalMatchesExecutableSubject({
      ...approval,
      expires_at: '2026-08-27T00:00:00.000Z',
    }, ['step:same-step'], approval.subject_digest!)).toBe(false)
    expect(approvalMatchesExecutableSubject({
      ...approval,
      consumed_at: '2026-08-28T00:00:00.000Z',
    }, ['step:same-step'], approval.subject_digest!)).toBe(false)
    expect(approvalMatchesExecutableSubject({
      ...approval,
      payload_ref: null,
    }, ['step:same-step'], approval.subject_digest!)).toBe(false)
  })

  test('exact-looking reveal and gate_override approvals never authorize execution', () => {
    const exactLookingApproval: Approval = {
      id: 'approval-c',
      action_type: 'reveal',
      target_ref: 'step:same-step',
      requested_by: 'tester',
      status: 'approved',
      approved_by: 'tester',
      approved_at: '2026-07-16T00:00:00.000Z',
      notes: null,
      subject_digest: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      payload_ref: 'payloads/reveal.json',
      policy_ref: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      consumed_at: null,
    }

    expect(approvalMatchesExecutableSubject(
      exactLookingApproval,
      ['step:same-step'],
      exactLookingApproval.subject_digest!,
    )).toBe(false)
    expect(approvalMatchesExecutableSubject(
      { ...exactLookingApproval, action_type: 'gate_override' },
      ['step:same-step'],
      exactLookingApproval.subject_digest!,
    )).toBe(false)
  })

  test('ordinary agent prompt content is not scanned as a shell script', () => {
    const policy = PolicyConfigSchema.parse({
      mode: 'POWER',
      command_allowlist: ['codex'],
      forbidden_patterns: ['THREADOS_FORBIDDEN_SENTINEL'],
    })
    const ordinaryAgentPrompt = 'Discuss THREADOS_FORBIDDEN_SENTINEL without executing it.'
    const payload: ExecutablePayload = {
      command: 'codex',
      args: ['-q', 'Read the prompt file at /tmp/prompt.md'],
      cwd: '/workspace',
    }

    expect(ordinaryAgentPrompt).toContain('THREADOS_FORBIDDEN_SENTINEL')
    expect(evaluateExecutablePayload(payload, policy).allowed).toBe(true)
  })

  test('rejects a script interpreter that differs from the authorized command', () => {
    const policy = PolicyConfigSchema.parse({
      mode: 'POWER',
      command_allowlist: ['sh'],
    })
    const payload: ExecutablePayload = {
      command: 'sh',
      args: [],
      cwd: '/workspace',
      script: {
        interpreter: 'powershell.exe',
        content: 'Write-Output mismatch',
      },
    }

    expect(() => evaluateExecutablePayload(payload, policy)).toThrow('interpreter')
  })
})

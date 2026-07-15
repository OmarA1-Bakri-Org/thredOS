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
    }

    expect(digestB).not.toBe(digestA)
    expect(approvalMatchesExecutableSubject(approval, ['step:same-step'], digestA)).toBe(true)
    expect(approvalMatchesExecutableSubject(approval, ['step:same-step'], digestB)).toBe(false)
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
})

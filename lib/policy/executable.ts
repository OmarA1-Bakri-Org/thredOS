import { createHash } from 'crypto'
import { relative } from 'path'
import type { Approval } from '@/lib/contracts/schemas'
import { PolicyEngine } from './engine'
import type { ExecutablePayload, PolicyConfig, PolicyResult } from './schema'

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function sha256Bytes(content: string | Buffer): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}

export function assertValidExecutablePayload(payload: ExecutablePayload): void {
  if (payload.script && payload.script.interpreter !== payload.command) {
    throw new Error(
      `Executable script interpreter '${payload.script.interpreter}' must match command '${payload.command}'`,
    )
  }
}

export function evaluateExecutablePayload(
  payload: ExecutablePayload,
  policy: PolicyConfig,
): PolicyResult {
  assertValidExecutablePayload(payload)
  return new PolicyEngine(policy).validate({
    type: 'run_command',
    command: payload.command,
    cwd: payload.cwd,
    executable_payload: payload,
  })
}

export function enforceExecutablePayload(
  payload: ExecutablePayload,
  policy: PolicyConfig,
  confirmed: boolean,
): PolicyResult {
  const decision = evaluateExecutablePayload(payload, policy)
  if (!decision.allowed) return decision
  if (decision.confirmation_required && !confirmed) {
    return {
      allowed: false,
      reason: 'Execution requires explicit confirmation in SAFE mode',
      confirmation_required: true,
    }
  }
  return { ...decision, confirmation_required: false }
}

export function executableSubjectDigest(
  payload: ExecutablePayload,
  basePath: string,
  policy: PolicyConfig,
): string {
  assertValidExecutablePayload(payload)
  const cwdContext = relative(basePath, payload.cwd).replaceAll('\\', '/') || '.'
  const scriptHash = payload.script ? sha256Bytes(payload.script.content) : null
  const policyIdentity = sha256Bytes(canonicalize(policy))
  return sha256Bytes(canonicalize({
    command: payload.command,
    args: payload.args,
    cwd: cwdContext,
    script: payload.script ? {
      interpreter: payload.script.interpreter,
      sha256: scriptHash,
    } : null,
    policy: policyIdentity,
  }))
}

export function approvalMatchesExecutableSubject(
  approval: Approval,
  targetRefs: string[],
  subjectDigest: string,
): boolean {
  return approval.status === 'approved'
    && targetRefs.includes(approval.target_ref)
    && approval.subject_digest === subjectDigest
}

import { describe, it, expect } from 'bun:test'
import type { Step, Gate } from '@/lib/sequence/schema'
import { GateReasonCode } from '@/lib/contracts/reason-codes'
import {
  checkDepsSatisfied,
  checkPolicyPass,
  checkSurfaceAccessPass,
  checkRevealAllowed,
} from './rules'

// ---------------------------------------------------------------------------
// checkDepsSatisfied
// ---------------------------------------------------------------------------

describe('checkDepsSatisfied', () => {
  it('returns PASS when step has no dependencies', () => {
    const step = { id: 's1', depends_on: [] } as unknown as Step
    const result = checkDepsSatisfied(step, [], [])
    expect(result.status).toBe('PASS')
    expect(result.reason_codes).toHaveLength(0)
  })

  it('returns PASS when all step dependencies are DONE', () => {
    const dep = { id: 'dep1', status: 'DONE' } as unknown as Step
    const step = { id: 's1', depends_on: ['dep1'] } as unknown as Step
    const result = checkDepsSatisfied(step, [dep], [])
    expect(result.status).toBe('PASS')
  })

  it('returns BLOCK+DEP_MISSING when a step dep is READY (not DONE)', () => {
    const dep = { id: 'dep1', status: 'READY' } as unknown as Step
    const step = { id: 's1', depends_on: ['dep1'] } as unknown as Step
    const result = checkDepsSatisfied(step, [dep], [])
    expect(result.status).toBe('BLOCK')
    expect(result.reason_codes).toContain(GateReasonCode.DEP_MISSING)
    expect(result.evidence_refs).toContain('step:dep1:status=READY')
  })

  it('returns BLOCK+DEP_FAILED when a step dep is FAILED', () => {
    const dep = { id: 'dep1', status: 'FAILED' } as unknown as Step
    const step = { id: 's1', depends_on: ['dep1'] } as unknown as Step
    const result = checkDepsSatisfied(step, [dep], [])
    expect(result.status).toBe('BLOCK')
    expect(result.reason_codes).toContain(GateReasonCode.DEP_FAILED)
    expect(result.evidence_refs).toContain('step:dep1:status=FAILED')
  })

  it('returns BLOCK+DEP_MISSING when a step dep is RUNNING', () => {
    const dep = { id: 'dep1', status: 'RUNNING' } as unknown as Step
    const step = { id: 's1', depends_on: ['dep1'] } as unknown as Step
    const result = checkDepsSatisfied(step, [dep], [])
    expect(result.status).toBe('BLOCK')
    expect(result.reason_codes).toContain(GateReasonCode.DEP_MISSING)
  })

  it('returns PASS when all gate dependencies are APPROVED', () => {
    const gate = { id: 'g1', status: 'APPROVED' } as unknown as Gate
    const step = { id: 's1', depends_on: ['g1'] } as unknown as Step
    const result = checkDepsSatisfied(step, [], [gate])
    expect(result.status).toBe('PASS')
  })

  it('returns BLOCK+DEP_FAILED when a gate dep is BLOCKED', () => {
    const gate = { id: 'g1', status: 'BLOCKED' } as unknown as Gate
    const step = { id: 's1', depends_on: ['g1'] } as unknown as Step
    const result = checkDepsSatisfied(step, [], [gate])
    expect(result.status).toBe('BLOCK')
    expect(result.reason_codes).toContain(GateReasonCode.DEP_FAILED)
    expect(result.evidence_refs).toContain('gate:g1:status=BLOCKED')
  })

  it('returns BLOCK+DEP_MISSING when a gate dep is PENDING', () => {
    const gate = { id: 'g1', status: 'PENDING' } as unknown as Gate
    const step = { id: 's1', depends_on: ['g1'] } as unknown as Step
    const result = checkDepsSatisfied(step, [], [gate])
    expect(result.status).toBe('BLOCK')
    expect(result.reason_codes).toContain(GateReasonCode.DEP_MISSING)
    expect(result.evidence_refs).toContain('gate:g1:status=PENDING')
  })

  it('returns BLOCK+DEP_MISSING when dep is not found in steps or gates', () => {
    const step = { id: 's1', depends_on: ['unknown'] } as unknown as Step
    const result = checkDepsSatisfied(step, [], [])
    expect(result.status).toBe('BLOCK')
    expect(result.reason_codes).toContain(GateReasonCode.DEP_MISSING)
    expect(result.evidence_refs).toContain('step:unknown:status=NOT_FOUND')
  })

  it('collects multiple failures from multiple deps', () => {
    const failed = { id: 'dep1', status: 'FAILED' } as unknown as Step
    const ready = { id: 'dep2', status: 'READY' } as unknown as Step
    const step = { id: 's1', depends_on: ['dep1', 'dep2'] } as unknown as Step
    const result = checkDepsSatisfied(step, [failed, ready], [])
    expect(result.status).toBe('BLOCK')
    expect(result.reason_codes).toContain(GateReasonCode.DEP_FAILED)
    expect(result.reason_codes).toContain(GateReasonCode.DEP_MISSING)
  })
})

// ---------------------------------------------------------------------------
// checkPolicyPass
// ---------------------------------------------------------------------------

describe('checkPolicyPass', () => {
  it('returns PASS when sideEffectClass is undefined', () => {
    const result = checkPolicyPass(undefined, 'SAFE', 'manual_only')
    expect(result.status).toBe('PASS')
  })

  it('returns PASS when sideEffectClass is "none"', () => {
    const result = checkPolicyPass('none', 'SAFE', 'approved_only')
    expect(result.status).toBe('PASS')
  })

  it('returns PASS for POWER mode with free side-effect mode', () => {
    const result = checkPolicyPass('write', 'POWER', 'free')
    expect(result.status).toBe('PASS')
  })

  it('returns NEEDS_APPROVAL for write + SAFE + manual_only', () => {
    const result = checkPolicyPass('write', 'SAFE', 'manual_only')
    expect(result.status).toBe('NEEDS_APPROVAL')
    expect(result.reason_codes).toContain(GateReasonCode.POLICY_BLOCKED)
  })

  it('returns NEEDS_APPROVAL for write + SAFE + approved_only', () => {
    const result = checkPolicyPass('write', 'SAFE', 'approved_only')
    expect(result.status).toBe('NEEDS_APPROVAL')
    expect(result.reason_codes).toContain(GateReasonCode.POLICY_BLOCKED)
  })

  it('returns NEEDS_APPROVAL for execute + SAFE + manual_only', () => {
    const result = checkPolicyPass('execute', 'SAFE', 'manual_only')
    expect(result.status).toBe('NEEDS_APPROVAL')
    expect(result.reason_codes).toContain(GateReasonCode.POLICY_BLOCKED)
  })

  it('returns NEEDS_APPROVAL for execute + POWER + approved_only', () => {
    const result = checkPolicyPass('execute', 'POWER', 'approved_only')
    expect(result.status).toBe('NEEDS_APPROVAL')
    expect(result.reason_codes).toContain(GateReasonCode.POLICY_BLOCKED)
  })

  it('returns PASS for read side-effect class (not write/execute)', () => {
    const result = checkPolicyPass('read', 'SAFE', 'manual_only')
    expect(result.status).toBe('PASS')
  })
})

// ---------------------------------------------------------------------------
// checkSurfaceAccessPass
// ---------------------------------------------------------------------------

describe('checkSurfaceAccessPass', () => {
  it('returns PASS for shared surface that is not a dependency', () => {
    const result = checkSurfaceAccessPass('shared', 'allow', false)
    expect(result.status).toBe('PASS')
  })

  it('returns BLOCK+ACCESS_DENIED for sealed surface that is not a dependency', () => {
    const result = checkSurfaceAccessPass('sealed', 'allow', false)
    expect(result.status).toBe('BLOCK')
    expect(result.reason_codes).toContain(GateReasonCode.ACCESS_DENIED)
  })

  it('returns PASS for sealed surface that IS a dependency', () => {
    const result = checkSurfaceAccessPass('sealed', 'allow', true)
    expect(result.status).toBe('PASS')
  })

  it('returns BLOCK+ACCESS_DENIED when crossSurfaceReads=deny and not a dependency', () => {
    const result = checkSurfaceAccessPass('shared', 'deny', false)
    expect(result.status).toBe('BLOCK')
    expect(result.reason_codes).toContain(GateReasonCode.ACCESS_DENIED)
  })

  it('returns PASS when crossSurfaceReads=deny but IS a dependency', () => {
    const result = checkSurfaceAccessPass('shared', 'deny', true)
    expect(result.status).toBe('PASS')
  })

  it('returns PASS when surfaceClass is undefined', () => {
    const result = checkSurfaceAccessPass(undefined, 'allow', false)
    expect(result.status).toBe('PASS')
  })
})

// ---------------------------------------------------------------------------
// checkRevealAllowed
// ---------------------------------------------------------------------------

describe('checkRevealAllowed', () => {
  it('returns PASS when surfaceClass is not sealed', () => {
    const result = checkRevealAllowed('shared', undefined)
    expect(result.status).toBe('PASS')
  })

  it('returns PASS when surfaceClass is undefined', () => {
    const result = checkRevealAllowed(undefined, undefined)
    expect(result.status).toBe('PASS')
  })

  it('returns PASS when sealed surface has been revealed', () => {
    const result = checkRevealAllowed('sealed', 'revealed')
    expect(result.status).toBe('PASS')
  })

  it('returns BLOCK+REVEAL_LOCKED when sealed and not revealed', () => {
    const result = checkRevealAllowed('sealed', 'sealed')
    expect(result.status).toBe('BLOCK')
    expect(result.reason_codes).toContain(GateReasonCode.REVEAL_LOCKED)
  })

  it('returns BLOCK+REVEAL_LOCKED when sealed and revealState is undefined', () => {
    const result = checkRevealAllowed('sealed', undefined)
    expect(result.status).toBe('BLOCK')
    expect(result.reason_codes).toContain(GateReasonCode.REVEAL_LOCKED)
  })
})

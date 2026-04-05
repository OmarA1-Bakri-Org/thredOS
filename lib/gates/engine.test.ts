import { describe, it, expect } from 'bun:test'
import type { Step } from '@/lib/sequence/schema'
import type { GateContext } from './engine'
import { evaluateStepGates, isStepRunnable, getBlockReasons } from './engine'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStep(overrides: Partial<{ id: string; depends_on: string[]; status: string; side_effect_class: string }>): Step {
  return {
    id: overrides.id ?? 's1',
    depends_on: overrides.depends_on ?? [],
    status: overrides.status ?? 'READY',
    side_effect_class: overrides.side_effect_class,
  } as unknown as Step
}

function makeCtx(overrides: Partial<GateContext> = {}): GateContext {
  return {
    policyMode: 'POWER',
    sideEffectMode: 'free',
    crossSurfaceReads: 'allow',
    surfaceClass: 'shared',
    revealState: null,
    isDependency: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// evaluateStepGates
// ---------------------------------------------------------------------------

describe('evaluateStepGates', () => {
  it('returns 3 PASS decisions for a step with no deps, no special conditions', () => {
    const step = makeStep({ depends_on: [] })
    const ctx = makeCtx()
    const decisions = evaluateStepGates(step, [], [], ctx)

    expect(decisions).toHaveLength(3)
    expect(decisions.every(d => d.status === 'PASS')).toBe(true)
  })

  it('decision subjects and gate_types are correct', () => {
    const step = makeStep({ id: 'my-step', depends_on: [] })
    const ctx = makeCtx()
    const decisions = evaluateStepGates(step, [], [], ctx)

    const types = decisions.map(d => d.gate_type)
    expect(types).toContain('deps_satisfied')
    expect(types).toContain('policy_pass')
    expect(types).toContain('surface_access_pass')

    decisions.forEach(d => {
      expect(d.subject_ref).toBe('my-step')
      expect(d.subject_type).toBe('step')
      expect(d.decided_by).toBe('threados')
      expect(d.id).toMatch(/^gd-/)
    })
  })

  it('returns BLOCK on deps_satisfied when dep is still RUNNING', () => {
    const dep = makeStep({ id: 'dep1', status: 'RUNNING' })
    const step = makeStep({ id: 's2', depends_on: ['dep1'] })
    const ctx = makeCtx()
    const decisions = evaluateStepGates(step, [dep], [], ctx)

    const depDecision = decisions.find(d => d.gate_type === 'deps_satisfied')
    expect(depDecision?.status).toBe('BLOCK')
    expect(depDecision?.reason_codes).toContain('DEP_MISSING')
  })

  it('returns PASS on deps_satisfied when dep is DONE', () => {
    const dep = makeStep({ id: 'dep1', status: 'DONE' })
    const step = makeStep({ id: 's2', depends_on: ['dep1'] })
    const ctx = makeCtx()
    const decisions = evaluateStepGates(step, [dep], [], ctx)

    const depDecision = decisions.find(d => d.gate_type === 'deps_satisfied')
    expect(depDecision?.status).toBe('PASS')
  })

  it('adds a 4th reveal_allowed decision when surfaceClass is sealed', () => {
    const step = makeStep({ depends_on: [] })
    const ctx = makeCtx({ surfaceClass: 'sealed', isDependency: true, revealState: 'revealed' })
    const decisions = evaluateStepGates(step, [], [], ctx)

    expect(decisions).toHaveLength(4)
    const revealDecision = decisions.find(d => d.gate_type === 'reveal_allowed')
    expect(revealDecision).toBeDefined()
    expect(revealDecision?.status).toBe('PASS')
  })

  it('reveal_allowed is BLOCK when sealed surface has not been revealed', () => {
    const step = makeStep({ depends_on: [] })
    const ctx = makeCtx({ surfaceClass: 'sealed', isDependency: true, revealState: null })
    const decisions = evaluateStepGates(step, [], [], ctx)

    const revealDecision = decisions.find(d => d.gate_type === 'reveal_allowed')
    expect(revealDecision?.status).toBe('BLOCK')
    expect(revealDecision?.reason_codes).toContain('REVEAL_LOCKED')
  })

  it('does not add reveal_allowed decision for non-sealed surfaces', () => {
    const step = makeStep({ depends_on: [] })
    const ctx = makeCtx({ surfaceClass: 'private' })
    const decisions = evaluateStepGates(step, [], [], ctx)

    expect(decisions).toHaveLength(3)
    expect(decisions.find(d => d.gate_type === 'reveal_allowed')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// isStepRunnable
// ---------------------------------------------------------------------------

describe('isStepRunnable', () => {
  it('returns true when all decisions are PASS', () => {
    const step = makeStep({ depends_on: [] })
    const ctx = makeCtx()
    const decisions = evaluateStepGates(step, [], [], ctx)
    expect(isStepRunnable(decisions)).toBe(true)
  })

  it('returns false when any decision is BLOCK', () => {
    const dep = makeStep({ id: 'dep1', status: 'RUNNING' })
    const step = makeStep({ id: 's2', depends_on: ['dep1'] })
    const ctx = makeCtx()
    const decisions = evaluateStepGates(step, [dep], [], ctx)
    expect(isStepRunnable(decisions)).toBe(false)
  })

  it('returns false when any decision is NEEDS_APPROVAL', () => {
    const step = makeStep({ depends_on: [], side_effect_class: 'write' })
    const ctx = makeCtx({ policyMode: 'SAFE', sideEffectMode: 'manual_only' })
    const decisions = evaluateStepGates(step, [], [], ctx)
    expect(isStepRunnable(decisions)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// getBlockReasons
// ---------------------------------------------------------------------------

describe('getBlockReasons', () => {
  it('returns empty array when all decisions are PASS', () => {
    const step = makeStep({ depends_on: [] })
    const ctx = makeCtx()
    const decisions = evaluateStepGates(step, [], [], ctx)
    expect(getBlockReasons(decisions)).toHaveLength(0)
  })

  it('extracts reason codes from BLOCK decisions', () => {
    const dep = makeStep({ id: 'dep1', status: 'FAILED' })
    const step = makeStep({ id: 's2', depends_on: ['dep1'] })
    const ctx = makeCtx()
    const decisions = evaluateStepGates(step, [dep], [], ctx)
    const reasons = getBlockReasons(decisions)
    expect(reasons).toContain('DEP_FAILED')
  })

  it('extracts reason codes from NEEDS_APPROVAL decisions', () => {
    const step = makeStep({ depends_on: [], side_effect_class: 'execute' })
    const ctx = makeCtx({ policyMode: 'SAFE', sideEffectMode: 'manual_only' })
    const decisions = evaluateStepGates(step, [], [], ctx)
    const reasons = getBlockReasons(decisions)
    expect(reasons).toContain('POLICY_BLOCKED')
  })

  it('collects reasons from multiple blocked decisions', () => {
    const dep = makeStep({ id: 'dep1', status: 'RUNNING' })
    const step = makeStep({ id: 's2', depends_on: ['dep1'], side_effect_class: 'write' })
    const ctx = makeCtx({ policyMode: 'SAFE', sideEffectMode: 'approved_only' })
    const decisions = evaluateStepGates(step, [dep], [], ctx)
    const reasons = getBlockReasons(decisions)
    expect(reasons).toContain('DEP_MISSING')
    expect(reasons).toContain('POLICY_BLOCKED')
  })
})

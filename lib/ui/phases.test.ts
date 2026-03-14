import { describe, test, expect } from 'bun:test'
import { derivePhases, findPhaseForStep, findPhaseForGate } from './phases'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeStep(id: string, opts: Partial<{ name: string; type: string; model: string; status: string; dependsOn: string[] }> = {}) {
  return {
    id,
    name: opts.name ?? id,
    type: opts.type ?? 'base',
    model: opts.model ?? 'claude-code',
    status: opts.status ?? 'ready',
    dependsOn: opts.dependsOn ?? [],
  }
}

function makeGate(id: string, opts: Partial<{ name: string; status: string }> = {}) {
  return {
    id,
    name: opts.name ?? id,
    status: opts.status ?? 'pending',
  }
}

// ── Empty / degenerate cases ─────────────────────────────────────────────────

describe('derivePhases — edge cases', () => {
  test('empty steps returns unresolved with no phases', () => {
    const result = derivePhases([], [])
    expect(result.phases).toHaveLength(0)
    expect(result.resolved).toBe(false)
  })

  test('empty steps with threadType override still returns unresolved', () => {
    const result = derivePhases([], [], 'f')
    expect(result.threadType).toBe('f')
    expect(result.resolved).toBe(false)
  })
})

// ── Base thread type ─────────────────────────────────────────────────────────

describe('derivePhases — base', () => {
  test('single step produces 1 phase with role=primary', () => {
    const steps = [makeStep('research')]
    const result = derivePhases(steps, [], 'base')
    expect(result.phases).toHaveLength(1)
    expect(result.phases[0].role).toBe('primary')
    expect(result.phases[0].stepIds).toEqual(['research'])
    expect(result.threadType).toBe('base')
    expect(result.resolved).toBe(true)
  })

  test('auto-detects base for single step', () => {
    const steps = [makeStep('sole')]
    const result = derivePhases(steps, [])
    expect(result.threadType).toBe('base')
  })

  test('single step with gate pairs correctly', () => {
    const steps = [makeStep('research')]
    const gates = [makeGate('gate-research')]
    const result = derivePhases(steps, gates, 'base')
    expect(result.phases[0].gateIds).toEqual(['gate-research'])
  })
})

// ── Parallel (p) thread type ─────────────────────────────────────────────────

describe('derivePhases — parallel (p)', () => {
  test('parallel steps all get role=primary', () => {
    const steps = [
      makeStep('agent-a'),
      makeStep('agent-b'),
      makeStep('agent-c'),
    ]
    const result = derivePhases(steps, [], 'p')
    expect(result.phases).toHaveLength(3)
    result.phases.forEach(phase => {
      expect(phase.role).toBe('primary')
    })
    expect(result.threadType).toBe('p')
  })

  test('auto-detects p when no dependencies exist', () => {
    const steps = [
      makeStep('worker-1'),
      makeStep('worker-2'),
    ]
    const result = derivePhases(steps, [])
    expect(result.threadType).toBe('p')
  })

  test('phases are ordered by step position', () => {
    const steps = [makeStep('first'), makeStep('second'), makeStep('third')]
    const result = derivePhases(steps, [], 'p')
    expect(result.phases[0].order).toBe(0)
    expect(result.phases[1].order).toBe(1)
    expect(result.phases[2].order).toBe(2)
  })
})

// ── Chained (c) thread type ──────────────────────────────────────────────────

describe('derivePhases — chained (c)', () => {
  test('chained steps all get role=primary', () => {
    const steps = [
      makeStep('step-1'),
      makeStep('step-2', { dependsOn: ['step-1'] }),
      makeStep('step-3', { dependsOn: ['step-2'] }),
    ]
    const result = derivePhases(steps, [], 'c')
    expect(result.phases).toHaveLength(3)
    result.phases.forEach(phase => {
      expect(phase.role).toBe('primary')
    })
  })

  test('auto-detects c for sequential dependencies', () => {
    const steps = [
      makeStep('a'),
      makeStep('b', { dependsOn: ['a'] }),
    ]
    const result = derivePhases(steps, [])
    expect(result.threadType).toBe('c')
  })

  test('gates pair with steps by ID pattern', () => {
    const steps = [
      makeStep('content-1'),
      makeStep('content-2', { dependsOn: ['content-1'] }),
    ]
    const gates = [
      makeGate('gate-content-1'),
      makeGate('gate-content-2'),
    ]
    const result = derivePhases(steps, gates, 'c')
    expect(result.phases[0].gateIds).toEqual(['gate-content-1'])
    expect(result.phases[1].gateIds).toEqual(['gate-content-2'])
  })
})

// ── Fusion (f) thread type ───────────────────────────────────────────────────

describe('derivePhases — fusion (f)', () => {
  test('last phase is synthesis, others are candidates', () => {
    const steps = [
      makeStep('candidate-1'),
      makeStep('candidate-2'),
      makeStep('synthesis', { dependsOn: ['candidate-1', 'candidate-2'] }),
    ]
    const result = derivePhases(steps, [], 'f')
    expect(result.phases).toHaveLength(3)
    expect(result.phases[0].role).toBe('candidate')
    expect(result.phases[1].role).toBe('candidate')
    expect(result.phases[2].role).toBe('synthesis')
  })

  test('auto-detects f for 2+ root steps + 1 multi-dep step', () => {
    const steps = [
      makeStep('a'),
      makeStep('b'),
      makeStep('c', { dependsOn: ['a', 'b'] }),
    ]
    const result = derivePhases(steps, [])
    expect(result.threadType).toBe('f')
  })

  test('4-candidate fusion still has 1 synthesis', () => {
    const candidates = ['c1', 'c2', 'c3', 'c4'].map(id => makeStep(id))
    const synth = makeStep('synth', { dependsOn: ['c1', 'c2', 'c3', 'c4'] })
    const result = derivePhases([...candidates, synth], [], 'f')
    expect(result.phases.filter(p => p.role === 'candidate')).toHaveLength(4)
    expect(result.phases.filter(p => p.role === 'synthesis')).toHaveLength(1)
  })
})

// ── Baton (b) thread type ────────────────────────────────────────────────────

describe('derivePhases — baton (b)', () => {
  test('all phases get role=handoff', () => {
    const steps = [
      makeStep('agent-1'),
      makeStep('agent-2', { dependsOn: ['agent-1'] }),
      makeStep('agent-3', { dependsOn: ['agent-2'] }),
    ]
    const result = derivePhases(steps, [], 'b')
    expect(result.phases).toHaveLength(3)
    result.phases.forEach(phase => {
      expect(phase.role).toBe('handoff')
    })
  })

  test('baton label uses step name', () => {
    const steps = [
      makeStep('drafter', { name: 'Draft Agent' }),
      makeStep('reviewer', { name: 'Review Agent' }),
    ]
    const result = derivePhases(steps, [], 'b')
    expect(result.phases[0].label).toBe('Draft Agent')
    expect(result.phases[1].label).toBe('Review Agent')
  })
})

// ── Long-autonomy (l) thread type ───────────────────────────────────────────

describe('derivePhases — long-autonomy (l)', () => {
  test('first phase is primary, rest are watchdog', () => {
    const steps = [
      makeStep('main-agent'),
      makeStep('watchdog-1'),
      makeStep('watchdog-2'),
    ]
    const result = derivePhases(steps, [], 'l')
    expect(result.phases[0].role).toBe('primary')
    expect(result.phases[1].role).toBe('watchdog')
    expect(result.phases[2].role).toBe('watchdog')
  })

  test('single step in long-autonomy is primary', () => {
    const steps = [makeStep('solo')]
    const result = derivePhases(steps, [], 'l')
    expect(result.phases[0].role).toBe('primary')
  })
})

// ── Phase ID format ──────────────────────────────────────────────────────────

describe('phase ID format', () => {
  test('phase ID is prefixed with "phase-"', () => {
    const steps = [makeStep('my-step')]
    const result = derivePhases(steps, [], 'base')
    expect(result.phases[0].id).toBe('phase-my-step')
  })
})

// ── Gate assignment ──────────────────────────────────────────────────────────

describe('gate assignment', () => {
  test('unmatched gates are assigned by position to gateless steps', () => {
    const steps = [makeStep('alpha'), makeStep('beta')]
    const gates = [makeGate('quality-check-1'), makeGate('quality-check-2')]
    // Neither gate ID contains step ID, so positional fallback kicks in
    const result = derivePhases(steps, gates, 'p')
    expect(result.phases[0].gateIds).toEqual(['quality-check-1'])
    expect(result.phases[1].gateIds).toEqual(['quality-check-2'])
  })

  test('more gates than steps — extras are unassigned', () => {
    const steps = [makeStep('only-step')]
    const gates = [makeGate('gate-only-step'), makeGate('orphan-gate')]
    const result = derivePhases(steps, gates, 'base')
    // First gate matched by ID, second has no step to attach to
    expect(result.phases[0].gateIds).toEqual(['gate-only-step'])
  })

  test('step with no gate gets empty gateIds', () => {
    const steps = [makeStep('no-gate-step')]
    const result = derivePhases(steps, [], 'base')
    expect(result.phases[0].gateIds).toEqual([])
  })
})

// ── findPhaseForStep / findPhaseForGate ──────────────────────────────────────

describe('findPhaseForStep', () => {
  test('returns the phase containing the step', () => {
    const steps = [makeStep('a'), makeStep('b')]
    const result = derivePhases(steps, [], 'p')
    const found = findPhaseForStep(result.phases, 'b')
    expect(found?.id).toBe('phase-b')
  })

  test('returns undefined for unknown step', () => {
    const steps = [makeStep('a')]
    const result = derivePhases(steps, [], 'base')
    expect(findPhaseForStep(result.phases, 'nonexistent')).toBeUndefined()
  })
})

describe('findPhaseForGate', () => {
  test('returns the phase containing the gate', () => {
    const steps = [makeStep('x')]
    const gates = [makeGate('gate-x')]
    const result = derivePhases(steps, gates, 'base')
    const found = findPhaseForGate(result.phases, 'gate-x')
    expect(found?.id).toBe('phase-x')
  })

  test('returns undefined for unknown gate', () => {
    const steps = [makeStep('x')]
    const result = derivePhases(steps, [], 'base')
    expect(findPhaseForGate(result.phases, 'gate-missing')).toBeUndefined()
  })
})

// ── Thread type override ─────────────────────────────────────────────────────

describe('thread type override', () => {
  test('override changes roles even when auto-detect would differ', () => {
    // These steps would auto-detect as 'p' (no deps), but we force 'f'
    const steps = [makeStep('a'), makeStep('b'), makeStep('c')]
    const result = derivePhases(steps, [], 'f')
    expect(result.threadType).toBe('f')
    expect(result.phases[0].role).toBe('candidate')
    expect(result.phases[1].role).toBe('candidate')
    expect(result.phases[2].role).toBe('synthesis')
  })

  test('override to baton changes all roles to handoff', () => {
    const steps = [makeStep('s1'), makeStep('s2')]
    const result = derivePhases(steps, [], 'b')
    expect(result.phases[0].role).toBe('handoff')
    expect(result.phases[1].role).toBe('handoff')
  })
})

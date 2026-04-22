import { describe, it, expect } from 'bun:test'
import type { Step } from '@/lib/sequence/schema'
import type { GateContext, CompletionGateContext } from './engine'
import { evaluateStepCompletionGates, evaluateStepGates, getBlockReasons, isStepRunnable } from './engine'

function makeStep(overrides: Partial<Step> = {}): Step {
  return {
    id: 's1',
    name: 'Step 1',
    kind: 'base',
    type: 'base',
    phase: 'default',
    agent_ref: null,
    prompt_file: '.threados/prompts/s1.md',
    prompt_ref: { id: 's1', version: 1, path: '.threados/prompts/s1.md' },
    model: 'codex',
    surface_ref: 'thread-s1',
    depends_on: [],
    status: 'READY',
    input_contract_ref: null,
    output_contract_ref: null,
    gate_set_ref: null,
    completion_contract: null,
    side_effect_class: 'none',
    ...overrides,
  }
}

function makeCtx(overrides: Partial<GateContext> = {}): GateContext {
  return {
    policyMode: 'POWER',
    sideEffectMode: 'free',
    crossSurfaceReads: 'allow',
    surfaceClass: 'shared',
    revealState: null,
    isDependency: true,
    inputManifestPresent: true,
    approvalPresent: true,
    ...overrides,
  }
}

function makeCompletionCtx(overrides: Partial<CompletionGateContext> = {}): CompletionGateContext {
  return {
    artifactManifestPresent: true,
    outputSchemaValid: true,
    completionContractSatisfied: true,
    ...overrides,
  }
}

describe('evaluateStepGates', () => {
  it('returns five PASS decisions for a normal runnable step', () => {
    const step = makeStep()
    const decisions = evaluateStepGates(step, [], [], makeCtx())

    expect(decisions).toHaveLength(5)
    expect(decisions.every(d => d.status === 'PASS')).toBe(true)
    expect(decisions.map(d => d.gate_type)).toEqual([
      'deps_satisfied',
      'required_inputs_present',
      'policy_pass',
      'approval_present',
      'surface_access_pass',
    ])
  })

  it('adds reveal_allowed for sealed surfaces', () => {
    const step = makeStep()
    const decisions = evaluateStepGates(step, [], [], makeCtx({ surfaceClass: 'sealed', revealState: 'revealed' }))

    expect(decisions.map(d => d.gate_type)).toContain('reveal_allowed')
    expect(decisions).toHaveLength(6)
  })

  it('returns blocked reasons for unresolved dependencies', () => {
    const dep = makeStep({ id: 'dep-1', status: 'RUNNING' })
    const step = makeStep({ id: 'child', depends_on: ['dep-1'] })
    const decisions = evaluateStepGates(step, [dep], [], makeCtx())

    expect(isStepRunnable(decisions)).toBe(false)
    expect(getBlockReasons(decisions)).toContain('DEP_MISSING')
  })

  it('requires approval when write side effects are gated', () => {
    const step = makeStep({ side_effect_class: 'write' })
    const decisions = evaluateStepGates(step, [], [], makeCtx({ policyMode: 'SAFE', sideEffectMode: 'approved_only', approvalPresent: false }))

    expect(isStepRunnable(decisions)).toBe(false)
    expect(getBlockReasons(decisions)).toContain('POLICY_BLOCKED')
    expect(getBlockReasons(decisions)).toContain('APPROVAL_MISSING')
  })

  it('treats approval evidence as satisfying approval-gated execution authority', () => {
    const step = makeStep({ side_effect_class: 'write' })
    const decisions = evaluateStepGates(step, [], [], makeCtx({ policyMode: 'SAFE', sideEffectMode: 'approved_only', approvalPresent: true }))

    expect(isStepRunnable(decisions)).toBe(true)
    expect(getBlockReasons(decisions)).toEqual([])
  })

  it('does not let approval evidence bypass non-approval blockers', () => {
    const step = makeStep({ side_effect_class: 'write' })
    const decisions = evaluateStepGates(step, [], [], makeCtx({
      policyMode: 'SAFE',
      sideEffectMode: 'approved_only',
      approvalPresent: true,
      surfaceClass: 'sealed',
      revealState: 'sealed',
      isDependency: false,
    }))

    expect(isStepRunnable(decisions)).toBe(false)
    expect(getBlockReasons(decisions)).toContain('ACCESS_DENIED')
    expect(getBlockReasons(decisions)).toContain('REVEAL_LOCKED')
  })

  it('blocks when required input manifests are missing', () => {
    const step = makeStep({ input_contract_ref: 'contracts/input.json' })
    const decisions = evaluateStepGates(step, [], [], makeCtx({ inputManifestPresent: false }))

    expect(isStepRunnable(decisions)).toBe(false)
    expect(getBlockReasons(decisions)).toContain('INPUT_MISSING')
  })
})

describe('evaluateStepCompletionGates', () => {
  it('returns PASS decisions for successful completion outputs', () => {
    const step = makeStep({ output_contract_ref: 'contracts/output.json', completion_contract: 'contracts/done.json', side_effect_class: 'write' })
    const decisions = evaluateStepCompletionGates(step, makeCompletionCtx())

    expect(decisions).toHaveLength(3)
    expect(decisions.every(d => d.status === 'PASS')).toBe(true)
  })

  it('blocks when artifact manifests are required but missing', () => {
    const step = makeStep({ side_effect_class: 'execute' })
    const decisions = evaluateStepCompletionGates(step, makeCompletionCtx({ artifactManifestPresent: false }))

    expect(getBlockReasons(decisions)).toContain('ARTIFACT_MISSING')
  })

  it('blocks when output contract validation fails', () => {
    const step = makeStep({ output_contract_ref: 'contracts/output.json' })
    const decisions = evaluateStepCompletionGates(step, makeCompletionCtx({ outputSchemaValid: false }))

    expect(getBlockReasons(decisions)).toContain('SCHEMA_INVALID')
  })

  it('blocks when completion contract is not satisfied', () => {
    const step = makeStep({ completion_contract: 'contracts/done.json' })
    const decisions = evaluateStepCompletionGates(step, makeCompletionCtx({ completionContractSatisfied: false }))

    expect(getBlockReasons(decisions)).toContain('CONTRACT_INCOMPLETE')
  })
})

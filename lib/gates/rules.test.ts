import { describe, it, expect } from 'bun:test'
import type { Step, Gate } from '@/lib/sequence/schema'
import { GateReasonCode } from '@/lib/contracts/reason-codes'
import {
  checkApprovalPresent,
  checkArtifactManifestPass,
  checkCompletionContractPass,
  checkDepsSatisfied,
  checkOutputSchemaPass,
  checkPolicyPass,
  checkRequiredInputsPresent,
  checkRevealAllowed,
  checkSurfaceAccessPass,
} from './rules'

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

describe('checkDepsSatisfied', () => {
  it('returns PASS when step has no dependencies', () => {
    const result = checkDepsSatisfied(makeStep(), [], [])
    expect(result.status).toBe('PASS')
  })

  it('returns BLOCK when dependencies are unresolved', () => {
    const dep = makeStep({ id: 'dep1', status: 'RUNNING' })
    const result = checkDepsSatisfied(makeStep({ depends_on: ['dep1'] }), [dep], [])
    expect(result.status).toBe('BLOCK')
    expect(result.reason_codes).toContain(GateReasonCode.DEP_MISSING)
  })

  it('treats skipped dependencies as satisfied', () => {
    const dep = makeStep({ id: 'dep1', status: 'SKIPPED' as Step['status'] })
    const result = checkDepsSatisfied(makeStep({ depends_on: ['dep1'] }), [dep], [])
    expect(result.status).toBe('PASS')
  })

  it('returns BLOCK when a dependency gate is pending', () => {
    const gate = { id: 'g1', status: 'PENDING' } as unknown as Gate
    const result = checkDepsSatisfied(makeStep({ depends_on: ['g1'] }), [], [gate])
    expect(result.reason_codes).toContain(GateReasonCode.DEP_MISSING)
  })
})

describe('checkRequiredInputsPresent', () => {
  it('passes when no input contract is required', () => {
    expect(checkRequiredInputsPresent(makeStep(), false).status).toBe('PASS')
  })

  it('blocks when an input contract is required but no manifest exists', () => {
    const result = checkRequiredInputsPresent(makeStep({ input_contract_ref: 'contracts/input.json' }), false)
    expect(result.status).toBe('BLOCK')
    expect(result.reason_codes).toContain(GateReasonCode.INPUT_MISSING)
  })
})

describe('checkPolicyPass', () => {
  it('passes when sideEffectClass is undefined', () => {
    expect(checkPolicyPass(undefined, 'SAFE', 'manual_only', false).status).toBe('PASS')
  })

  it('returns NEEDS_APPROVAL for gated write side effects without approval evidence', () => {
    const result = checkPolicyPass('write', 'SAFE', 'approved_only', false)
    expect(result.status).toBe('NEEDS_APPROVAL')
    expect(result.reason_codes).toContain(GateReasonCode.POLICY_BLOCKED)
  })

  it('passes gated write side effects when approval evidence is present', () => {
    const result = checkPolicyPass('write', 'SAFE', 'approved_only', true)
    expect(result.status).toBe('PASS')
  })
})

describe('checkApprovalPresent', () => {
  it('passes when approval is not required', () => {
    expect(checkApprovalPresent(makeStep({ side_effect_class: 'none' }), 'manual_only', false).status).toBe('PASS')
  })

  it('returns NEEDS_APPROVAL when approval is required but missing', () => {
    const result = checkApprovalPresent(makeStep({ side_effect_class: 'write' }), 'approved_only', false)
    expect(result.status).toBe('NEEDS_APPROVAL')
    expect(result.reason_codes).toContain(GateReasonCode.APPROVAL_MISSING)
  })
})

describe('checkSurfaceAccessPass', () => {
  it('blocks sealed non-dependency access', () => {
    const result = checkSurfaceAccessPass('sealed', 'allow', false)
    expect(result.status).toBe('BLOCK')
    expect(result.reason_codes).toContain(GateReasonCode.ACCESS_DENIED)
  })

  it('passes dependency access', () => {
    expect(checkSurfaceAccessPass('shared', 'dependency_only', true).status).toBe('PASS')
  })
})

describe('checkRevealAllowed', () => {
  it('blocks sealed unrevealed surfaces', () => {
    const result = checkRevealAllowed('sealed', 'sealed')
    expect(result.status).toBe('BLOCK')
    expect(result.reason_codes).toContain(GateReasonCode.REVEAL_LOCKED)
  })
})

describe('completion rules', () => {
  it('artifact manifest gate blocks when required manifest is missing', () => {
    const result = checkArtifactManifestPass(makeStep({ side_effect_class: 'write' }), false)
    expect(result.status).toBe('BLOCK')
    expect(result.reason_codes).toContain(GateReasonCode.ARTIFACT_MISSING)
  })

  it('output schema gate blocks when contract validation fails', () => {
    const result = checkOutputSchemaPass(makeStep({ output_contract_ref: 'contracts/output.json' }), false)
    expect(result.status).toBe('BLOCK')
    expect(result.reason_codes).toContain(GateReasonCode.SCHEMA_INVALID)
  })

  it('completion contract gate blocks when incomplete', () => {
    const result = checkCompletionContractPass(makeStep({ completion_contract: 'contracts/done.json' }), false)
    expect(result.status).toBe('BLOCK')
    expect(result.reason_codes).toContain(GateReasonCode.CONTRACT_INCOMPLETE)
  })
})

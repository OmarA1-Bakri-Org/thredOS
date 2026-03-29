export const GateReasonCode = {
  DEP_MISSING: 'DEP_MISSING',
  DEP_FAILED: 'DEP_FAILED',
  INPUT_MISSING: 'INPUT_MISSING',
  SCHEMA_INVALID: 'SCHEMA_INVALID',
  POLICY_BLOCKED: 'POLICY_BLOCKED',
  ARTIFACT_MISSING: 'ARTIFACT_MISSING',
  APPROVAL_MISSING: 'APPROVAL_MISSING',
  ACCESS_DENIED: 'ACCESS_DENIED',
  REVEAL_LOCKED: 'REVEAL_LOCKED',
  CONTRACT_INCOMPLETE: 'CONTRACT_INCOMPLETE',
} as const

export type GateReasonCode = typeof GateReasonCode[keyof typeof GateReasonCode]

export const GateDecisionStatus = {
  PASS: 'PASS',
  BLOCK: 'BLOCK',
  NEEDS_APPROVAL: 'NEEDS_APPROVAL',
} as const

export type GateDecisionStatus = typeof GateDecisionStatus[keyof typeof GateDecisionStatus]

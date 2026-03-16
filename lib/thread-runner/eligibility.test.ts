import { describe, test, expect } from 'bun:test'
import { checkEligibilityFromState, type EligibilityInput } from './eligibility'

describe('checkEligibilityFromState', () => {
  test('all locked when no agents, no subscription', () => {
    const input: EligibilityInput = { hasVerifiedAgent: false, hasVmAccess: false, hasActiveSubscription: false }
    const result = checkEligibilityFromState(input)
    expect(result.eligible).toBe(false)
    expect(result.requirements.every(r => !r.met)).toBe(true)
  })

  test('verified-identity met when hasVerifiedAgent is true', () => {
    const input: EligibilityInput = { hasVerifiedAgent: true, hasVmAccess: false, hasActiveSubscription: false }
    const result = checkEligibilityFromState(input)
    const req = result.requirements.find(r => r.key === 'verified-identity')
    expect(req?.met).toBe(true)
    expect(result.eligible).toBe(false)
  })

  test('all met when all inputs true', () => {
    const input: EligibilityInput = { hasVerifiedAgent: true, hasVmAccess: true, hasActiveSubscription: true }
    const result = checkEligibilityFromState(input)
    expect(result.eligible).toBe(true)
    expect(result.requirements.every(r => r.met)).toBe(true)
  })

  test('vm-access met when hasVmAccess is true', () => {
    const input: EligibilityInput = { hasVerifiedAgent: false, hasVmAccess: true, hasActiveSubscription: false }
    const result = checkEligibilityFromState(input)
    const req = result.requirements.find(r => r.key === 'vm-access')
    expect(req?.met).toBe(true)
  })

  test('active-subscription met when hasActiveSubscription is true', () => {
    const input: EligibilityInput = { hasVerifiedAgent: false, hasVmAccess: false, hasActiveSubscription: true }
    const result = checkEligibilityFromState(input)
    const req = result.requirements.find(r => r.key === 'active-subscription')
    expect(req?.met).toBe(true)
  })
})

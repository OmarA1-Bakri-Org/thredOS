import type { EligibilityStatus } from './types'

export interface EligibilityInput {
  hasVerifiedAgent: boolean
  hasVmAccess: boolean
  hasActiveSubscription: boolean
}

/**
 * Determine eligibility from computed state flags.
 * This replaces the hardcoded checkEligibility() and makes testing straightforward.
 */
export function checkEligibilityFromState(input: EligibilityInput): EligibilityStatus {
  const requirements = [
    {
      key: 'verified-identity',
      label: 'Verified Identity',
      description: 'A verified ThreadOS identity linked to your account.',
      met: input.hasVerifiedAgent,
    },
    {
      key: 'vm-access',
      label: 'VM Access',
      description: 'Managed VM runtime for sandboxed execution environments.',
      met: input.hasVmAccess,
    },
    {
      key: 'active-subscription',
      label: 'Active Subscription',
      description: 'An active paid subscription to the Thread Runner tier.',
      met: input.hasActiveSubscription,
    },
  ]

  return {
    eligible: requirements.every(r => r.met),
    requirements,
  }
}

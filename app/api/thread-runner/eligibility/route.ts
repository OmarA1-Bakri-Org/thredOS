import { getBasePath } from '@/lib/config'
import { readAgentState } from '@/lib/agents/repository'
import { checkEligibilityFromState } from '@/lib/thread-runner/eligibility'
import { enableThreadRunner } from '@/lib/hosted'

export async function GET() {
  try {
    if (!enableThreadRunner()) {
      return Response.json({
        eligible: false,
        requirements: [],
        error: 'Thread Runner is not part of the thredOS Desktop launch surface',
      }, { status: 403 })
    }

    const bp = getBasePath()
    const agentState = await readAgentState(bp)

    // hasVerifiedAgent: at least one agent registered with a real builder identity
    // Exclude workshop placeholder agents (builderId: 'workshop') from counting as verified
    const hasVerifiedAgent = agentState.agents.some(a => a.builderId && a.builderId !== 'workshop' && a.builderName)

    // hasVmAccess: currently always false (no VM runtime yet)
    const hasVmAccess = false

    // hasActiveSubscription: currently always false (no subscription system yet)
    const hasActiveSubscription = false

    const status = checkEligibilityFromState({
      hasVerifiedAgent,
      hasVmAccess,
      hasActiveSubscription,
    })

    return Response.json(status)
  } catch {
    return Response.json({ eligible: false, requirements: [] }, { status: 500 })
  }
}

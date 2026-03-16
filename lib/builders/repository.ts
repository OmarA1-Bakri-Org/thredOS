import type { AgentRegistration } from '@/lib/agents/types'
import type { Pack } from '@/lib/packs/types'
import { PACK_STATUS_PRIORITY } from '@/lib/packs/types'
import type { BuilderProfile } from './types'

/**
 * Derive a builder profile from agent and pack data.
 * This is a pure computation -- no I/O. The API route gathers the inputs.
 */
export function deriveBuilderProfile(
  builderId: string,
  builderName: string,
  agents: AgentRegistration[],
  packs: Pack[],
): BuilderProfile {
  const builderAgents = agents.filter(a => a.builderId === builderId)
  const builderPacks = packs.filter(p => p.builderId === builderId)

  const highestPackStatus = builderPacks.length > 0
    ? builderPacks.reduce((best, p) =>
        PACK_STATUS_PRIORITY[p.highestStatus] > PACK_STATUS_PRIORITY[best.highestStatus] ? p : best
      ).highestStatus
    : null

  const earliestAgent = builderAgents.length > 0
    ? builderAgents.reduce((earliest, a) =>
        a.registeredAt < earliest.registeredAt ? a : earliest
      )
    : null

  return {
    id: builderId,
    name: builderName,
    registeredAt: earliestAgent?.registeredAt ?? new Date().toISOString(),
    stats: {
      totalAgents: builderAgents.length,
      totalPacks: builderPacks.length,
      highestPackStatus,
      avgQuality: 0, // Placeholder until quality scoring is implemented
      totalRaces: 0,
      totalWins: 0,
    },
  }
}

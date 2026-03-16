import type { PackStatus } from '@/lib/packs/types'

export interface BuilderStats {
  totalAgents: number
  totalPacks: number
  highestPackStatus: PackStatus | null
  avgQuality: number
  totalRaces: number
  totalWins: number
}

export interface BuilderProfile {
  id: string
  name: string
  registeredAt: string
  stats: BuilderStats
}

export interface EligibilityRequirement {
  key: string
  label: string
  description: string
  met: boolean
}

export interface EligibilityStatus {
  eligible: boolean
  requirements: EligibilityRequirement[]
}

export interface CombatantRun {
  id: string
  raceId: string
  combatantId: string
  threadSurfaceId: string
  startedAt: string
  endedAt: string | null
  status: 'pending' | 'running' | 'completed' | 'failed' | 'disqualified'
  verifiedAt: string | null
  placement: number | null
}

export interface Race {
  id: string
  name: string
  division: string
  classification: string
  startAt: string
  endAt: string | null
  status: 'open' | 'running' | 'completed' | 'cancelled'
  maxCombatants: number
  combatantRunIds: string[]
}

export interface RaceResult {
  raceId: string
  placements: Array<{
    combatantRunId: string
    combatantId: string
    placement: number
    time: number
    verifiedAt: string
  }>
}

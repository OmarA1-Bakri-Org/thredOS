export type PackType = 'challenger' | 'champion' | 'hero'

export type PackStatus = 'challenger' | 'champion' | 'hero'

export interface Pack {
  id: string
  type: PackType
  builderId: string
  builderName: string
  division: string
  classification: string
  acquiredAt: string
  highestStatus: PackStatus
  statusHistory: PackStatusEntry[]
}

export interface PackStatusEntry {
  status: PackStatus
  achievedAt: string
  context: string
}

/** Display priority: hero > champion > challenger */
export const PACK_STATUS_PRIORITY: Record<PackStatus, number> = {
  challenger: 1,
  champion: 2,
  hero: 3,
}

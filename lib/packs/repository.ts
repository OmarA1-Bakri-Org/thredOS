import type { Pack, PackStatus, PackStatusEntry } from './types'
import { PACK_STATUS_PRIORITY } from './types'

export class PackRepository {
  private packs: Map<string, Pack> = new Map()

  addPack(pack: Pack): void {
    this.packs.set(pack.id, pack)
  }

  getPack(packId: string): Pack | null {
    return this.packs.get(packId) ?? null
  }

  listPacks(): Pack[] {
    return Array.from(this.packs.values())
  }

  listPacksByBuilder(builderId: string): Pack[] {
    return this.listPacks().filter(p => p.builderId === builderId)
  }

  getHighestStatus(builderId: string): PackStatus | null {
    const builderPacks = this.listPacksByBuilder(builderId)
    if (builderPacks.length === 0) return null

    return builderPacks.reduce<PackStatus>((highest, pack) => {
      return PACK_STATUS_PRIORITY[pack.highestStatus] > PACK_STATUS_PRIORITY[highest]
        ? pack.highestStatus
        : highest
    }, builderPacks[0].highestStatus)
  }

  promoteStatus(packId: string, newStatus: PackStatus, context: string): boolean {
    const pack = this.packs.get(packId)
    if (!pack) return false

    if (PACK_STATUS_PRIORITY[newStatus] <= PACK_STATUS_PRIORITY[pack.highestStatus]) {
      return false
    }

    const entry: PackStatusEntry = {
      status: newStatus,
      achievedAt: new Date().toISOString(),
      context,
    }
    pack.statusHistory.push(entry)
    pack.highestStatus = newStatus
    return true
  }
}

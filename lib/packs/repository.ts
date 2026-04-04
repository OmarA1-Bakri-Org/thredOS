import { existsSync } from 'fs'
import { mkdir, readFile } from 'fs/promises'
import { join } from 'path'
import { writeFileAtomic } from '@/lib/fs/atomic'
import type { Pack, PackStatus, PackStatusEntry } from './types'
import { PACK_STATUS_PRIORITY } from './types'

// ---------------------------------------------------------------------------
// Persistent file-based state
// ---------------------------------------------------------------------------

const PACK_STATE_PATH = '.threados/state/packs.json'

export interface PackState {
  version: 1
  packs: Pack[]
}

const DEFAULT_PACK_STATE: PackState = {
  version: 1,
  packs: [],
}

export function getPackStatePath(basePath: string): string {
  return join(basePath, PACK_STATE_PATH)
}

export async function readPackState(basePath: string): Promise<PackState> {
  const fullPath = getPackStatePath(basePath)
  if (!existsSync(fullPath)) {
    return structuredClone(DEFAULT_PACK_STATE)
  }

  const raw = JSON.parse(await readFile(fullPath, 'utf-8')) as Partial<PackState>

  return {
    version: 1,
    packs: Array.isArray(raw.packs) ? raw.packs : [],
  }
}

export async function writePackState(basePath: string, state: PackState): Promise<void> {
  const fullPath = getPackStatePath(basePath)
  await mkdir(join(basePath, '.threados/state'), { recursive: true })
  await writeFileAtomic(fullPath, `${JSON.stringify({ ...state, version: 1 }, null, 2)}\n`)
}

export async function updatePackState(
  basePath: string,
  updater: (currentState: PackState) => PackState | Promise<PackState>,
): Promise<PackState> {
  const currentState = await readPackState(basePath)
  const nextState = await updater(currentState)
  await writePackState(basePath, nextState)
  return nextState
}

export function selectBestPackForBuilder(packs: Pack[], builderId: string): Pack | null {
  const builderPacks = packs.filter(pack => pack.builderId === builderId)
  if (builderPacks.length === 0) return null

  return builderPacks.reduce((best, pack) =>
    PACK_STATUS_PRIORITY[pack.highestStatus] > PACK_STATUS_PRIORITY[best.highestStatus] ? pack : best
  )
}

// ---------------------------------------------------------------------------
// In-memory repository (unchanged)
// ---------------------------------------------------------------------------

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

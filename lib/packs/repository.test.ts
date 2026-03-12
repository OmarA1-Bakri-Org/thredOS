import { describe, test, expect, beforeEach } from 'bun:test'
import { PackRepository } from './repository'
import type { Pack } from './types'

describe('PackRepository', () => {
  let repo: PackRepository

  beforeEach(() => {
    repo = new PackRepository()
  })

  const makePack = (overrides: Partial<Pack> = {}): Pack => ({
    id: 'pack-1',
    type: 'challenger',
    builderId: 'builder-1',
    builderName: 'Alice',
    division: 'open',
    classification: 'qualifier',
    acquiredAt: '2026-03-12T00:00:00.000Z',
    highestStatus: 'challenger',
    statusHistory: [{ status: 'challenger', achievedAt: '2026-03-12T00:00:00.000Z', context: 'Initial pack' }],
    ...overrides,
  })

  test('addPack and getPack', () => {
    const pack = makePack()
    repo.addPack(pack)
    expect(repo.getPack('pack-1')).toEqual(pack)
  })

  test('getPack returns null for unknown id', () => {
    expect(repo.getPack('nonexistent')).toBeNull()
  })

  test('listPacks returns all packs', () => {
    repo.addPack(makePack({ id: 'pack-1' }))
    repo.addPack(makePack({ id: 'pack-2', builderName: 'Bob' }))
    expect(repo.listPacks()).toHaveLength(2)
  })

  test('listPacksByBuilder filters by builder', () => {
    repo.addPack(makePack({ id: 'pack-1', builderId: 'builder-1' }))
    repo.addPack(makePack({ id: 'pack-2', builderId: 'builder-2' }))
    repo.addPack(makePack({ id: 'pack-3', builderId: 'builder-1' }))
    expect(repo.listPacksByBuilder('builder-1')).toHaveLength(2)
    expect(repo.listPacksByBuilder('builder-2')).toHaveLength(1)
  })

  test('getHighestStatus returns null for unknown builder', () => {
    expect(repo.getHighestStatus('nonexistent')).toBeNull()
  })

  test('getHighestStatus returns highest across packs', () => {
    repo.addPack(makePack({ id: 'pack-1', builderId: 'b1', highestStatus: 'challenger' }))
    repo.addPack(makePack({ id: 'pack-2', builderId: 'b1', highestStatus: 'hero' }))
    repo.addPack(makePack({ id: 'pack-3', builderId: 'b1', highestStatus: 'champion' }))
    expect(repo.getHighestStatus('b1')).toBe('hero')
  })

  test('promoteStatus upgrades when new status is higher', () => {
    repo.addPack(makePack({ highestStatus: 'challenger' }))
    const result = repo.promoteStatus('pack-1', 'champion', 'Won qualifier')
    expect(result).toBe(true)
    expect(repo.getPack('pack-1')!.highestStatus).toBe('champion')
    expect(repo.getPack('pack-1')!.statusHistory).toHaveLength(2)
  })

  test('promoteStatus rejects equal or lower status', () => {
    repo.addPack(makePack({ highestStatus: 'champion' }))
    expect(repo.promoteStatus('pack-1', 'challenger', 'Downgrade')).toBe(false)
    expect(repo.promoteStatus('pack-1', 'champion', 'Same')).toBe(false)
    expect(repo.getPack('pack-1')!.highestStatus).toBe('champion')
  })

  test('promoteStatus returns false for unknown pack', () => {
    expect(repo.promoteStatus('nonexistent', 'hero', 'Nope')).toBe(false)
  })
})

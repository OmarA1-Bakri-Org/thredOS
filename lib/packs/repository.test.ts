import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  PackRepository,
  getPackStatePath,
  readPackState,
  selectBestPackForBuilder,
  updatePackState,
  writePackState,
} from './repository'
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

  test('selectBestPackForBuilder returns the highest-status pack for a builder', () => {
    const bestPack = selectBestPackForBuilder([
      makePack({ id: 'pack-1', builderId: 'b1', highestStatus: 'challenger' }),
      makePack({ id: 'pack-2', builderId: 'b1', highestStatus: 'hero' }),
      makePack({ id: 'pack-3', builderId: 'b1', highestStatus: 'champion' }),
      makePack({ id: 'pack-4', builderId: 'b2', highestStatus: 'hero' }),
    ], 'b1')

    expect(bestPack?.id).toBe('pack-2')
    expect(bestPack?.highestStatus).toBe('hero')
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

// ---------------------------------------------------------------------------
// Persistent file-based state tests
// ---------------------------------------------------------------------------

describe('pack persistent state', () => {
  let basePath: string

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

  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-pack-state-'))
  })

  afterEach(async () => {
    await rm(basePath, { recursive: true, force: true })
  })

  test('readPackState returns empty state when file does not exist', async () => {
    await expect(readPackState(basePath)).resolves.toEqual({
      version: 1,
      packs: [],
    })
  })

  test('writePackState creates the file and readPackState reads it back', async () => {
    const pack = makePack()
    await writePackState(basePath, {
      version: 1,
      packs: [pack],
    })

    const persisted = await readPackState(basePath)
    expect(persisted).toEqual({
      version: 1,
      packs: [pack],
    })
  })

  test('state file lives at .threados/state/packs.json', async () => {
    const pack = makePack()
    await writePackState(basePath, {
      version: 1,
      packs: [pack],
    })

    const filePath = getPackStatePath(basePath)
    expect(filePath).toBe(join(basePath, '.threados/state/packs.json'))

    const raw = JSON.parse(await readFile(filePath, 'utf-8'))
    expect(raw.packs).toHaveLength(1)
    expect(raw.version).toBe(1)
  })

  test('readPackState defaults packs to empty array when missing on disk', async () => {
    const filePath = getPackStatePath(basePath)
    await Bun.write(filePath, JSON.stringify({ version: 1 }))

    await expect(readPackState(basePath)).resolves.toEqual({
      version: 1,
      packs: [],
    })
  })

  test('updatePackState modifies existing state', async () => {
    const pack1 = makePack({ id: 'pack-1' })
    await writePackState(basePath, {
      version: 1,
      packs: [pack1],
    })

    const pack2 = makePack({ id: 'pack-2', builderName: 'Bob', builderId: 'builder-2' })
    const nextState = await updatePackState(basePath, (current) => ({
      ...current,
      packs: [...current.packs, pack2],
    }))

    expect(nextState.packs).toHaveLength(2)
    expect(nextState.packs[0].id).toBe('pack-1')
    expect(nextState.packs[1].id).toBe('pack-2')

    // Verify it persisted to disk
    const reRead = await readPackState(basePath)
    expect(reRead.packs).toHaveLength(2)
  })

  test('updatePackState works on empty initial state', async () => {
    const pack = makePack()
    const nextState = await updatePackState(basePath, (current) => ({
      ...current,
      packs: [...current.packs, pack],
    }))

    expect(nextState.packs).toHaveLength(1)
    expect(nextState.packs[0].id).toBe('pack-1')
  })
})

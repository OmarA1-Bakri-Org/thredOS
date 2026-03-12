import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  AgentRepository,
  getAgentStatePath,
  readAgentState,
  updateAgentState,
  writeAgentState,
} from './repository'
import type { AgentRegistration } from './types'

// ---------------------------------------------------------------------------
// In-memory AgentRepository
// ---------------------------------------------------------------------------

describe('AgentRepository', () => {
  let repo: AgentRepository

  beforeEach(() => {
    repo = new AgentRepository()
  })

  const makeAgent = (overrides: Partial<AgentRegistration> = {}): AgentRegistration => ({
    id: 'agent-1',
    name: 'Alpha Agent',
    description: 'Test agent',
    registeredAt: '2026-03-12T00:00:00.000Z',
    builderId: 'builder-1',
    builderName: 'Alice',
    threadSurfaceIds: [],
    metadata: {},
    ...overrides,
  })

  test('registerAgent and getAgent', () => {
    const agent = makeAgent()
    repo.registerAgent(agent)
    expect(repo.getAgent('agent-1')).toEqual(agent)
  })

  test('getAgent returns null for unknown id', () => {
    expect(repo.getAgent('nonexistent')).toBeNull()
  })

  test('listAgents returns all registered agents', () => {
    repo.registerAgent(makeAgent({ id: 'agent-1' }))
    repo.registerAgent(makeAgent({ id: 'agent-2', name: 'Beta Agent' }))
    expect(repo.listAgents()).toHaveLength(2)
  })

  test('getAgentByBuilderId returns the first matching agent', () => {
    repo.registerAgent(makeAgent({ id: 'agent-1', builderId: 'builder-1' }))
    repo.registerAgent(makeAgent({ id: 'agent-2', builderId: 'builder-2' }))
    const found = repo.getAgentByBuilderId('builder-1')
    expect(found).not.toBeNull()
    expect(found!.id).toBe('agent-1')
  })

  test('getAgentByBuilderId returns null for unknown builder', () => {
    expect(repo.getAgentByBuilderId('nonexistent')).toBeNull()
  })

  test('linkThreadSurface adds surface id to agent', () => {
    repo.registerAgent(makeAgent())
    const linked = repo.linkThreadSurface('agent-1', 'ts-1')
    expect(linked).toBe(true)
    expect(repo.getAgent('agent-1')!.threadSurfaceIds).toContain('ts-1')
  })

  test('linkThreadSurface returns false for unknown agent', () => {
    expect(repo.linkThreadSurface('nonexistent', 'ts-1')).toBe(false)
  })

  test('linkThreadSurface returns false if surface already linked', () => {
    repo.registerAgent(makeAgent({ threadSurfaceIds: ['ts-1'] }))
    expect(repo.linkThreadSurface('agent-1', 'ts-1')).toBe(false)
  })

  test('unlinkThreadSurface removes surface id from agent', () => {
    repo.registerAgent(makeAgent({ threadSurfaceIds: ['ts-1', 'ts-2'] }))
    const unlinked = repo.unlinkThreadSurface('agent-1', 'ts-1')
    expect(unlinked).toBe(true)
    expect(repo.getAgent('agent-1')!.threadSurfaceIds).toEqual(['ts-2'])
  })

  test('unlinkThreadSurface returns false for unknown agent', () => {
    expect(repo.unlinkThreadSurface('nonexistent', 'ts-1')).toBe(false)
  })

  test('unlinkThreadSurface returns false if surface not linked', () => {
    repo.registerAgent(makeAgent({ threadSurfaceIds: [] }))
    expect(repo.unlinkThreadSurface('agent-1', 'ts-1')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Persistent file-based state
// ---------------------------------------------------------------------------

describe('Persistent AgentState', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'threados-agent-state-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const makeAgent = (overrides: Partial<AgentRegistration> = {}): AgentRegistration => ({
    id: 'agent-1',
    name: 'Alpha Agent',
    description: 'Test agent',
    registeredAt: '2026-03-12T00:00:00.000Z',
    builderId: 'builder-1',
    builderName: 'Alice',
    threadSurfaceIds: ['ts-1'],
    metadata: { tier: 'pro' },
    ...overrides,
  })

  test('readAgentState returns empty default state when file does not exist', async () => {
    const state = await readAgentState(tempDir)
    expect(state.version).toBe(1)
    expect(state.agents).toEqual([])
  })

  test('writeAgentState creates the file and readAgentState reads it back', async () => {
    const agent = makeAgent()
    await writeAgentState(tempDir, { version: 1, agents: [agent] })

    const statePath = getAgentStatePath(tempDir)
    expect(existsSync(statePath)).toBe(true)

    const restored = await readAgentState(tempDir)
    expect(restored.version).toBe(1)
    expect(restored.agents).toEqual([agent])
  })

  test('writeAgentState persists to .threados/state/agents.json', async () => {
    const agent = makeAgent()
    await writeAgentState(tempDir, { version: 1, agents: [agent] })

    const filePath = getAgentStatePath(tempDir)
    const raw = JSON.parse(await readFile(filePath, 'utf-8'))
    expect(raw.version).toBe(1)
    expect(raw.agents).toHaveLength(1)
    expect(raw.agents[0].id).toBe('agent-1')
  })

  test('readAgentState defaults agents to an empty array when property is missing', async () => {
    const filePath = getAgentStatePath(tempDir)
    await Bun.write(filePath, JSON.stringify({ version: 1 }))

    const state = await readAgentState(tempDir)
    expect(state.agents).toEqual([])
  })

  test('updateAgentState modifies existing state', async () => {
    const agent = makeAgent()
    await writeAgentState(tempDir, { version: 1, agents: [agent] })

    const updated = await updateAgentState(tempDir, (current) => ({
      ...current,
      agents: [
        ...current.agents,
        makeAgent({ id: 'agent-2', name: 'Beta Agent', builderId: 'builder-2' }),
      ],
    }))

    expect(updated.agents).toHaveLength(2)
    expect(updated.agents[1].id).toBe('agent-2')

    // Verify persisted to disk
    const readBack = await readAgentState(tempDir)
    expect(readBack.agents).toHaveLength(2)
    expect(readBack.agents[1].name).toBe('Beta Agent')
  })

  test('updateAgentState works on empty state when file does not exist', async () => {
    const updated = await updateAgentState(tempDir, (current) => ({
      ...current,
      agents: [makeAgent()],
    }))

    expect(updated.agents).toHaveLength(1)
    expect(updated.agents[0].id).toBe('agent-1')

    const readBack = await readAgentState(tempDir)
    expect(readBack.agents).toHaveLength(1)
  })

  test('getAgentStatePath returns correct path', () => {
    expect(getAgentStatePath('/some/base')).toBe(join('/some/base', '.threados/state/agents.json'))
  })
})

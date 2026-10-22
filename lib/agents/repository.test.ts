import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rename, rm, symlink, unlink } from 'fs/promises'
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
import { setSafeIoBeforeOpenHookForTests } from '@/lib/security/safe-io'
import { setAtomicBoundaryHookForTests } from '@/lib/fs/atomic'

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
    setSafeIoBeforeOpenHookForTests(null)
    setAtomicBoundaryHookForTests(null)
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

  test('concurrent updates from separate processes preserve every registration', async () => {
    const workerSource = `
      import { updateAgentState } from ${JSON.stringify(new URL('./repository.ts', import.meta.url).href)}
      const [basePath, workerId] = process.argv.slice(1)
      process.stdout.write('ready\\n')
      for await (const _chunk of process.stdin) break
      for (let revision = 0; revision < 3; revision += 1) {
        await updateAgentState(basePath, async current => {
          await new Promise(resolve => setTimeout(resolve, 30))
          return {
            ...current,
            agents: [...current.agents, {
              id: workerId + '-' + revision,
              name: workerId,
              registeredAt: '2026-03-12T00:00:00.000Z',
              builderId: 'builder-1',
              builderName: 'Builder',
              threadSurfaceIds: [],
            }],
          }
        })
      }
    `
    const workerIds = ['alpha', 'beta', 'gamma', 'delta']
    const workers = workerIds.map(id => Bun.spawn([process.execPath, '-e', workerSource, tempDir, id], {
      cwd: process.cwd(),
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    }))

    try {
      // Release all processes only after each has loaded the real repository.
      await Promise.all(workers.map(async worker => {
        const reader = worker.stdout.getReader()
        try {
          const ready = await reader.read()
          expect(new TextDecoder().decode(ready.value)).toBe('ready\n')
        } finally {
          reader.releaseLock()
        }
      }))
      for (const worker of workers) {
        worker.stdin.write('start\n')
        worker.stdin.end()
      }
      const results = await Promise.all(workers.map(async worker => ({
        exitCode: await worker.exited,
        stderr: await new Response(worker.stderr).text(),
      })))
      expect(results).toEqual(workerIds.map(() => ({ exitCode: 0, stderr: '' })))

      const state = await readAgentState(tempDir)
      expect(state.agents.map(agent => agent.id).sort()).toEqual(
        workerIds.flatMap(id => [0, 1, 2].map(revision => `${id}-${revision}`)).sort(),
      )
    } finally {
      for (const worker of workers) {
        if (worker.exitCode === null) worker.kill()
      }
      await Promise.all(workers.map(worker => worker.exited))
    }
  }, 15_000)

  test('a rejected update releases the lock without changing the registry', async () => {
    await writeAgentState(tempDir, { version: 1, agents: [makeAgent()] })
    await expect(updateAgentState(tempDir, () => {
      throw new Error('Rejected registration')
    })).rejects.toThrow('Rejected registration')

    await updateAgentState(tempDir, current => ({
      ...current,
      agents: [...current.agents, makeAgent({ id: 'agent-2' })],
    }))
    expect((await readAgentState(tempDir)).agents.map(agent => agent.id)).toEqual(['agent-1', 'agent-2'])
  })

  test('registry operations reject a state directory symlink escaping the project', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'threados-agent-outside-'))
    try {
      await mkdir(join(tempDir, '.threados'))
      await symlink(outside, join(tempDir, '.threados/state'), 'junction')
      await expect(writeAgentState(tempDir, { version: 1, agents: [makeAgent()] })).rejects.toThrow('allowed root')
      await expect(updateAgentState(tempDir, state => state)).rejects.toThrow('allowed root')
      expect(existsSync(join(outside, 'agents.json'))).toBe(false)
      expect(existsSync(join(outside, 'agents.json.lock'))).toBe(false)
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  test('registry reads reject an agents file symlink escaping the project', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'threados-agent-outside-'))
    try {
      const outsideFile = join(outside, 'agents.json')
      await Bun.write(outsideFile, JSON.stringify({ version: 1, agents: [makeAgent()] }))
      await mkdir(join(tempDir, '.threados/state'), { recursive: true })
      await symlink(outsideFile, getAgentStatePath(tempDir))
      await expect(readAgentState(tempDir)).rejects.toThrow('allowed root')
      await expect(writeAgentState(tempDir, { version: 1, agents: [] })).rejects.toThrow('allowed root')
      expect(JSON.parse(await readFile(outsideFile, 'utf-8')).agents).toHaveLength(1)
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  test('registry reads reject a final file swapped to an escaping symlink before open', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'threados-agent-outside-'))
    try {
      const outsideFile = join(outside, 'agents.json')
      await Bun.write(outsideFile, JSON.stringify({ version: 1, agents: [makeAgent({ id: 'outside-agent' })] }))
      await writeAgentState(tempDir, { version: 1, agents: [makeAgent()] })
      const statePath = getAgentStatePath(tempDir)
      let swapped = false
      setSafeIoBeforeOpenHookForTests(async ({ operation, filePath }) => {
        if (operation === 'read' && filePath === statePath) {
          await unlink(statePath)
          await symlink(outsideFile, statePath)
          swapped = true
        }
      })

      await expect(readAgentState(tempDir)).rejects.toThrow()
      expect(swapped).toBe(true)
      expect(JSON.parse(await readFile(outsideFile, 'utf-8')).agents[0].id).toBe('outside-agent')
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  for (const boundary of ['before-lock-open', 'before-temp-open'] as const) {
    test(`registry rejects a state directory swapped outside the project at ${boundary}`, async () => {
      const outside = await mkdtemp(join(tmpdir(), 'threados-agent-outside-'))
      try {
        await writeAgentState(tempDir, { version: 1, agents: [makeAgent()] })
        const statePath = getAgentStatePath(tempDir)
        let swapped = false
        let outsideEntryOpened = false
        setAtomicBoundaryHookForTests(async context => {
          const targetPath = boundary === 'before-lock-open' ? `${statePath}.lock` : statePath
          if (context.targetPath !== targetPath) return
          if (context.stage === boundary && !swapped) {
            await rename(join(tempDir, '.threados/state'), join(tempDir, '.threados/state-original'))
            await symlink(outside, join(tempDir, '.threados/state'), 'junction')
            swapped = true
          }
          if (swapped && ['after-lock-open-before-write', 'after-temp-open-before-write'].includes(context.stage)) {
            outsideEntryOpened = true
          }
        })

        await expect(writeAgentState(tempDir, { version: 1, agents: [] })).rejects.toThrow()
        expect(swapped).toBe(true)
        expect(outsideEntryOpened).toBe(false)
        expect(existsSync(join(outside, 'agents.json'))).toBe(false)
        expect(existsSync(join(outside, 'agents.json.lock'))).toBe(false)
      } finally {
        await rm(outside, { recursive: true, force: true })
      }
    })
  }

  test('getAgentStatePath returns correct path', () => {
    expect(getAgentStatePath('/some/base')).toBe(join('/some/base', '.threados/state/agents.json'))
  })
})

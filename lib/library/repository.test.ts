import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, access, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  deleteLibraryAsset,
  ensureLibraryStructure,
  ensurePromptAssetForStep,
  listLibraryAssets,
  readLibraryAsset,
  syncAgentAsset,
  upsertLibraryAsset,
} from './repository'

let basePath: string

describe.serial('library repository', () => {
  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-library-test-'))
  })

  afterEach(async () => {
    await rm(basePath, { recursive: true, force: true })
  })

  test('initializes canonical structure and system skills', async () => {
    await ensureLibraryStructure(basePath)

    await access(join(basePath, '.threados/library.yaml'))
    await access(join(basePath, '.threados/skills/search/SKILL.md'))
    await access(join(basePath, '.threados/agents'))

    const skills = await listLibraryAssets(basePath, 'skill')
    expect(skills.map(skill => skill.id)).toContain('spawn')
  })

  test('creates prompt assets and syncs markdown-backed entries', async () => {
    await ensureLibraryStructure(basePath)
    const prompt = await ensurePromptAssetForStep(basePath, 'node-a', 'Node A')
    expect(prompt.id).toBe('node-a')
    await access(join(basePath, '.threados/prompts/node-a.md'))

    const asset = await readLibraryAsset(basePath, 'prompt', 'node-a')
    expect(asset.entry?.title).toBe('Node A')
    expect(asset.content).toContain('Node A')
  })

  test('upserts, versions, and deletes canonical assets', async () => {
    await ensureLibraryStructure(basePath)

    const first = await upsertLibraryAsset(basePath, {
      kind: 'skill',
      id: 'custom-skill',
      title: 'Custom Skill',
      content: '# Custom Skill\n',
    })
    const second = await upsertLibraryAsset(basePath, {
      kind: 'skill',
      id: 'custom-skill',
      title: 'Custom Skill',
      content: '# Custom Skill v2\n',
    })

    expect(first.version).toBe(1)
    expect(second.version).toBe(2)

    const deleted = await deleteLibraryAsset(basePath, 'skill', 'custom-skill')
    expect(deleted).toBe(true)
    const asset = await readLibraryAsset(basePath, 'skill', 'custom-skill')
    expect(asset.entry).toBeNull()
  })

  test('syncs agent markdown assets', async () => {
    await ensureLibraryStructure(basePath)
    const agent = await syncAgentAsset(basePath, {
      id: 'agent-a',
      name: 'Agent A',
      registeredAt: new Date().toISOString(),
      builderId: 'builder-1',
      builderName: 'Builder',
      threadSurfaceIds: [],
      model: 'codex',
      role: 'researcher',
      tools: ['browser'],
      skillRefs: [],
      composition: {
        model: 'codex',
        role: 'researcher',
        skillRefs: [],
        tools: ['browser'],
        identityHash: 'hash',
      },
      version: 1,
    })

    expect(agent.kind).toBe('agent')
    await access(join(basePath, '.threados/agents/agent-a/AGENT.md'))
    const content = await readFile(join(basePath, '.threados/agents/agent-a/AGENT.md'), 'utf8')
    expect(content).toContain('Agent A')
    expect(content).toContain('researcher')
  })
})

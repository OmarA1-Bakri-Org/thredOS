import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadPack } from './loader'

const VALID_PACK_YAML = `
id: test-pack
version: 1.0.0
name: Test Pack
thread_types:
  - base
  - p
default_policy: SAFE
agents:
  - agent-one
surface_classes:
  - shared
  - sealed
phases:
  - id: phase-alpha
    label: Alpha Phase
    order: 0
  - id: phase-beta
    label: Beta Phase
    order: 1
steps:
  - id: step-one
    name: Step One
    type: base
    model: gpt-4o
    phase: phase-alpha
    surface_class: shared
    depends_on: []
  - id: step-two
    name: Step Two
    type: p
    model: gpt-4o
    phase: phase-beta
    surface_class: sealed
    depends_on:
      - step-one
gate_sets: []
`

describe('loadPack', () => {
  let basePath: string

  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-loader-test-'))
  })

  afterEach(async () => {
    await rm(basePath, { recursive: true, force: true })
  })

  test('loads a valid pack.yaml and returns parsed manifest', async () => {
    const packDir = join(basePath, '.threados/packs/test-pack/1.0.0')
    await mkdir(packDir, { recursive: true })
    await writeFile(join(packDir, 'pack.yaml'), VALID_PACK_YAML, 'utf-8')

    const manifest = await loadPack(basePath, 'test-pack', '1.0.0')

    expect(manifest.id).toBe('test-pack')
    expect(manifest.version).toBe('1.0.0')
    expect(manifest.name).toBe('Test Pack')
    expect(manifest.thread_types).toEqual(['base', 'p'])
    expect(manifest.default_policy).toBe('SAFE')
    expect(manifest.agents).toEqual(['agent-one'])
    expect(manifest.phases).toHaveLength(2)
    expect(manifest.phases[0]).toEqual({ id: 'phase-alpha', label: 'Alpha Phase', order: 0 })
    expect(manifest.steps).toHaveLength(2)
    expect(manifest.steps[0].id).toBe('step-one')
    expect(manifest.steps[1].id).toBe('step-two')
    expect(manifest.steps[1].depends_on).toEqual(['step-one'])
    expect(manifest.steps[1].surface_class).toBe('sealed')
  })

  test('throws for missing pack file', async () => {
    await expect(loadPack(basePath, 'nonexistent-pack', '1.0.0')).rejects.toThrow()
  })
})

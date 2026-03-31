import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import YAML from 'yaml'
import { createTempDir, cleanTempDir } from '../../test/helpers/setup'
import { PolicyEngine } from './engine'
import { PolicyConfigSchema } from './schema'

describe('PolicyEngine', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await createTempDir()
    await mkdir(join(tmpDir, '.threados'), { recursive: true })
  })

  afterEach(async () => {
    await cleanTempDir(tmpDir)
  })

  test('missing policy file uses safe defaults', async () => {
    const engine = await PolicyEngine.load(tmpDir)
    expect(engine.getConfig().mode).toBe('SAFE')
  })

  test('loads policy from YAML', async () => {
    const config = PolicyConfigSchema.parse({
      mode: 'POWER',
      command_allowlist: ['echo', 'cat'],
      cwd_patterns: ['/home/**'],
      max_fanout: 5,
      max_concurrent: 3,
      forbidden_patterns: ['rm -rf'],
    })
    await writeFile(join(tmpDir, '.threados/policy.yaml'), YAML.stringify(config))
    const engine = await PolicyEngine.load(tmpDir)
    expect(engine.getConfig().mode).toBe('POWER')
    expect(engine.getConfig().max_fanout).toBe(5)
  })

  test('SAFE mode requires confirmation for commands', async () => {
    const engine = await PolicyEngine.load(tmpDir)
    const result = engine.validate({ type: 'run_command', command: 'echo hello' })
    expect(result.allowed).toBe(true)
    expect(result.confirmation_required).toBe(true)
  })

  test('POWER mode no confirmation', async () => {
    await writeFile(join(tmpDir, '.threados/policy.yaml'), YAML.stringify({ mode: 'POWER' }))
    const engine = await PolicyEngine.load(tmpDir)
    const result = engine.validate({ type: 'run_command', command: 'echo hello' })
    expect(result.allowed).toBe(true)
    expect(result.confirmation_required).toBe(false)
  })

  test('command allowlist blocks unlisted', async () => {
    await writeFile(join(tmpDir, '.threados/policy.yaml'), YAML.stringify({
      mode: 'POWER',
      command_allowlist: ['echo', 'cat'],
    }))
    const engine = await PolicyEngine.load(tmpDir)
    const result = engine.validate({ type: 'run_command', command: 'rm file' })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('allowlist')
  })

  test('command allowlist allows listed', async () => {
    await writeFile(join(tmpDir, '.threados/policy.yaml'), YAML.stringify({
      mode: 'POWER',
      command_allowlist: ['echo'],
    }))
    const engine = await PolicyEngine.load(tmpDir)
    const result = engine.validate({ type: 'run_command', command: 'echo hello' })
    expect(result.allowed).toBe(true)
  })

  test('CWD restriction blocks', async () => {
    await writeFile(join(tmpDir, '.threados/policy.yaml'), YAML.stringify({
      mode: 'POWER',
      cwd_patterns: ['/home/*'],
    }))
    const engine = await PolicyEngine.load(tmpDir)
    const result = engine.validate({ type: 'run_command', command: 'ls', cwd: '/etc/secret' })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('CWD')
  })

  test('fanout limit exceeded', async () => {
    await writeFile(join(tmpDir, '.threados/policy.yaml'), YAML.stringify({
      mode: 'POWER',
      max_fanout: 3,
    }))
    const engine = await PolicyEngine.load(tmpDir)
    const result = engine.validate({ type: 'fanout', fanout_count: 5 })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('Fanout')
  })

  test('concurrent limit exceeded', async () => {
    await writeFile(join(tmpDir, '.threados/policy.yaml'), YAML.stringify({
      mode: 'POWER',
      max_concurrent: 2,
    }))
    const engine = await PolicyEngine.load(tmpDir)
    const result = engine.validate({ type: 'concurrent', concurrent_count: 4 })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('Concurrent')
  })

  test('forbidden pattern blocks command', async () => {
    await writeFile(join(tmpDir, '.threados/policy.yaml'), YAML.stringify({
      mode: 'POWER',
      forbidden_patterns: ['rm\\s+-rf', 'sudo'],
    }))
    const engine = await PolicyEngine.load(tmpDir)
    expect(engine.validate({ type: 'run_command', command: 'rm -rf /' }).allowed).toBe(false)
    expect(engine.validate({ type: 'run_command', command: 'sudo apt install' }).allowed).toBe(false)
    expect(engine.validate({ type: 'run_command', command: 'echo safe' }).allowed).toBe(true)
  })
})

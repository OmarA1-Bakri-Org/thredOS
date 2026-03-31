import { describe, test, expect } from 'bun:test'
import { PolicyConfigSchema } from './schema'

describe('PolicyConfigSchema V.1 extensions', () => {
  test('accepts side_effect_mode', () => {
    for (const mode of ['manual_only', 'approved_only', 'free']) {
      const result = PolicyConfigSchema.safeParse({ side_effect_mode: mode })
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.side_effect_mode).toBe(mode)
    }
  })

  test('rejects invalid side_effect_mode', () => {
    const result = PolicyConfigSchema.safeParse({ side_effect_mode: 'unlimited' })
    expect(result.success).toBe(false)
  })

  test('defaults all new fields correctly', () => {
    const config = PolicyConfigSchema.parse({})
    expect(config.side_effect_mode).toBe('manual_only')
    expect(config.network_mode).toBe('off')
    expect(config.allowed_domains).toEqual([])
    expect(config.surface_default_visibility).toBe('dependency')
    expect(config.cross_surface_reads).toBe('dependency_only')
    expect(config.sealed_surface_projection).toBe('manifest_only')
    expect(config.export_mode).toBe('local_bundle')
  })

  test('accepts allowed_domains array', () => {
    const result = PolicyConfigSchema.safeParse({
      allowed_domains: ['api.github.com', 'registry.npmjs.org'],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.allowed_domains).toEqual(['api.github.com', 'registry.npmjs.org'])
    }
  })

  test('accepts all network_mode values', () => {
    for (const mode of ['off', 'allowlist', 'open']) {
      const result = PolicyConfigSchema.safeParse({ network_mode: mode })
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.network_mode).toBe(mode)
    }
  })

  test('accepts all surface_default_visibility values', () => {
    for (const vis of ['public', 'dependency', 'self_only']) {
      const result = PolicyConfigSchema.safeParse({ surface_default_visibility: vis })
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.surface_default_visibility).toBe(vis)
    }
  })

  test('accepts all cross_surface_reads values', () => {
    for (const mode of ['deny', 'dependency_only']) {
      const result = PolicyConfigSchema.safeParse({ cross_surface_reads: mode })
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.cross_surface_reads).toBe(mode)
    }
  })

  test('accepts all sealed_surface_projection values', () => {
    for (const mode of ['manifest_only', 'full']) {
      const result = PolicyConfigSchema.safeParse({ sealed_surface_projection: mode })
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.sealed_surface_projection).toBe(mode)
    }
  })

  test('accepts all export_mode values', () => {
    for (const mode of ['off', 'local_bundle']) {
      const result = PolicyConfigSchema.safeParse({ export_mode: mode })
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.export_mode).toBe(mode)
    }
  })

  test('existing policies without new fields still parse', () => {
    const config = PolicyConfigSchema.parse({
      mode: 'POWER',
      command_allowlist: ['bun', 'npm'],
      max_fanout: 5,
    })
    expect(config.mode).toBe('POWER')
    expect(config.side_effect_mode).toBe('manual_only')
    expect(config.network_mode).toBe('off')
    expect(config.cross_surface_reads).toBe('dependency_only')
    expect(config.sealed_surface_projection).toBe('manifest_only')
    expect(config.export_mode).toBe('local_bundle')
  })
})

import { describe, test, expect } from 'bun:test'
import { PolicyModeSchema, PolicyConfigSchema } from './schema'

describe('PolicyModeSchema', () => {
  test('accepts SAFE', () => {
    expect(PolicyModeSchema.parse('SAFE')).toBe('SAFE')
  })

  test('accepts POWER', () => {
    expect(PolicyModeSchema.parse('POWER')).toBe('POWER')
  })

  test('rejects invalid modes', () => {
    expect(() => PolicyModeSchema.parse('YOLO')).toThrow()
    expect(() => PolicyModeSchema.parse('')).toThrow()
    expect(() => PolicyModeSchema.parse('safe')).toThrow()
  })
})

describe('PolicyConfigSchema', () => {
  test('parses minimal config with defaults', () => {
    const config = PolicyConfigSchema.parse({})
    expect(config.mode).toBe('SAFE')
    expect(config.command_allowlist).toEqual([])
    expect(config.cwd_patterns).toEqual(['**'])
    expect(config.max_fanout).toBe(10)
    expect(config.max_concurrent).toBe(5)
    expect(config.forbidden_patterns).toEqual([])
  })

  test('parses full config', () => {
    const config = PolicyConfigSchema.parse({
      mode: 'POWER',
      command_allowlist: ['npm', 'bun'],
      cwd_patterns: ['/project/**'],
      max_fanout: 20,
      max_concurrent: 10,
      forbidden_patterns: ['rm -rf'],
    })
    expect(config.mode).toBe('POWER')
    expect(config.command_allowlist).toEqual(['npm', 'bun'])
    expect(config.max_fanout).toBe(20)
    expect(config.max_concurrent).toBe(10)
    expect(config.forbidden_patterns).toEqual(['rm -rf'])
  })

  test('rejects invalid mode in config', () => {
    expect(() => PolicyConfigSchema.parse({ mode: 'INVALID' })).toThrow()
  })

  test('rejects non-numeric max_fanout', () => {
    expect(() => PolicyConfigSchema.parse({ max_fanout: 'ten' })).toThrow()
  })
})

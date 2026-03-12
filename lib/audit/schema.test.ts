import { describe, test, expect } from 'bun:test'
import { AuditEntrySchema } from './schema'

describe('AuditEntrySchema', () => {
  test('parses valid audit entry', () => {
    const entry = {
      timestamp: '2026-03-12T00:00:00.000Z',
      actor: 'api',
      action: 'step.add',
      target: 'step-a',
      result: 'ok',
    }
    const parsed = AuditEntrySchema.parse(entry)
    expect(parsed.timestamp).toBe(entry.timestamp)
    expect(parsed.actor).toBe('api')
    expect(parsed.action).toBe('step.add')
    expect(parsed.target).toBe('step-a')
    expect(parsed.result).toBe('ok')
  })

  test('parses entry with optional payload', () => {
    const entry = {
      timestamp: '2026-03-12T00:00:00.000Z',
      actor: 'cli',
      action: 'gate.approve',
      target: 'gate-1',
      payload: { gateId: 'gate-1', approvedBy: 'user' },
      result: 'ok',
    }
    const parsed = AuditEntrySchema.parse(entry)
    expect(parsed.payload).toBeDefined()
    expect(parsed.payload?.gateId).toBe('gate-1')
  })

  test('parses entry without payload', () => {
    const entry = {
      timestamp: '2026-03-12T00:00:00.000Z',
      actor: 'api',
      action: 'step.rm',
      target: 'step-b',
      result: 'ok',
    }
    const parsed = AuditEntrySchema.parse(entry)
    expect(parsed.payload).toBeUndefined()
  })

  test('rejects entry missing required fields', () => {
    expect(() => AuditEntrySchema.parse({})).toThrow()
    expect(() => AuditEntrySchema.parse({ timestamp: 'now' })).toThrow()
  })

  test('rejects entry with invalid types', () => {
    expect(() =>
      AuditEntrySchema.parse({
        timestamp: 123,
        actor: 'api',
        action: 'test',
        target: 'x',
        result: 'ok',
      })
    ).toThrow()
  })
})

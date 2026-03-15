import { describe, test, expect } from 'bun:test'
import { computeGateMetrics, type GateAuditEntry } from './metrics'

describe('computeGateMetrics', () => {
  test('returns zero metrics for empty history', () => {
    const result = computeGateMetrics('gate-1', [])
    expect(result.totalAttempts).toBe(0)
    expect(result.approvalRate).toBe(0)
    expect(result.avgTimeToApprovalMs).toBe(0)
  })

  test('computes approval rate from approve/block entries', () => {
    const entries: GateAuditEntry[] = [
      { action: 'gate approve', gateId: 'gate-1', timestamp: '2026-01-01T00:10:00Z' },
      { action: 'gate block', gateId: 'gate-1', timestamp: '2026-01-01T00:20:00Z' },
      { action: 'gate approve', gateId: 'gate-1', timestamp: '2026-01-01T00:30:00Z' },
    ]
    const result = computeGateMetrics('gate-1', entries)
    expect(result.totalAttempts).toBe(3)
    expect(result.approvalRate).toBe(67)
  })

  test('filters by gateId', () => {
    const entries: GateAuditEntry[] = [
      { action: 'gate approve', gateId: 'gate-1', timestamp: '2026-01-01T00:10:00Z' },
      { action: 'gate approve', gateId: 'gate-2', timestamp: '2026-01-01T00:20:00Z' },
    ]
    const result = computeGateMetrics('gate-1', entries)
    expect(result.totalAttempts).toBe(1)
  })

  test('computes avg time from first block to first approve', () => {
    const entries: GateAuditEntry[] = [
      { action: 'gate block', gateId: 'gate-1', timestamp: '2026-01-01T00:00:00Z' },
      { action: 'gate approve', gateId: 'gate-1', timestamp: '2026-01-01T00:05:00Z' },
    ]
    const result = computeGateMetrics('gate-1', entries)
    expect(result.avgTimeToApprovalMs).toBe(300_000)
  })
})

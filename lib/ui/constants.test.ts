import { describe, test, expect } from 'bun:test'
import { STATUS_COLORS } from './constants'

describe('STATUS_COLORS', () => {
  test('defines color for READY', () => {
    expect(STATUS_COLORS.READY).toBe('#94a3b8')
  })

  test('defines color for RUNNING', () => {
    expect(STATUS_COLORS.RUNNING).toBe('#3b82f6')
  })

  test('defines color for DONE', () => {
    expect(STATUS_COLORS.DONE).toBe('#22c55e')
  })

  test('defines color for FAILED', () => {
    expect(STATUS_COLORS.FAILED).toBe('#ef4444')
  })

  test('defines color for BLOCKED', () => {
    expect(STATUS_COLORS.BLOCKED).toBe('#f97316')
  })

  test('defines color for NEEDS_REVIEW', () => {
    expect(STATUS_COLORS.NEEDS_REVIEW).toBe('#eab308')
  })

  test('defines color for PENDING', () => {
    expect(STATUS_COLORS.PENDING).toBe('#94a3b8')
  })

  test('defines color for APPROVED', () => {
    expect(STATUS_COLORS.APPROVED).toBe('#22c55e')
  })

  test('covers all expected status values', () => {
    const keys = Object.keys(STATUS_COLORS)
    expect(keys).toContain('READY')
    expect(keys).toContain('RUNNING')
    expect(keys).toContain('DONE')
    expect(keys).toContain('FAILED')
    expect(keys).toContain('BLOCKED')
    expect(keys).toContain('NEEDS_REVIEW')
    expect(keys).toContain('PENDING')
    expect(keys).toContain('APPROVED')
    expect(keys.length).toBe(8)
  })
})

import { describe, expect, test } from 'bun:test'
import { decideWorkspaceRetention } from './retention'

describe('workspace retention', () => {
  test('retains successful M1 output until Change Set apply exists', () => {
    expect(decideWorkspaceRetention('retain_until_applied', {
      outcome: 'successful',
    })).toEqual({ action: 'retain', reason: 'awaiting_apply' })
  })

  test('retains failure, review, interruption, and explicit retain-always output', () => {
    expect(decideWorkspaceRetention('retain_on_failure', { outcome: 'failed' }).action).toBe('retain')
    expect(decideWorkspaceRetention('cleanup_on_success', { outcome: 'needs_review' }).action).toBe('retain')
    expect(decideWorkspaceRetention('cleanup_on_success', { outcome: 'interrupted' }).action).toBe('retain')
    expect(decideWorkspaceRetention('retain_always', { outcome: 'applied' }).action).toBe('retain')
  })

  test('cleans only applied success or a cancelled pristine workspace when policy permits', () => {
    expect(decideWorkspaceRetention('cleanup_on_success', { outcome: 'applied' }))
      .toEqual({ action: 'cleanup', reason: 'success_applied' })
    expect(decideWorkspaceRetention('retain_until_applied', { outcome: 'applied' }).action).toBe('cleanup')
    expect(decideWorkspaceRetention('retain_on_failure', { outcome: 'successful' }).action).toBe('retain')
    expect(decideWorkspaceRetention('cleanup_on_success', { outcome: 'successful' }).action).toBe('retain')
    expect(decideWorkspaceRetention('cleanup_on_success', {
      outcome: 'cancelled_before_write',
      hasUsefulOutput: false,
    }).action).toBe('cleanup')
    expect(decideWorkspaceRetention('cleanup_on_success', {
      outcome: 'cancelled_before_write',
      hasUsefulOutput: true,
    }).action).toBe('retain')
  })
})

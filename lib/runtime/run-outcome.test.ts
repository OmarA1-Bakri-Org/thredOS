import { describe, expect, test } from 'bun:test'
import { RuntimeServiceError } from './errors'
import type { StepAttemptStatus } from './schema'
import { deriveTerminalRunOutcome } from './run-outcome'

function attempts(...statuses: StepAttemptStatus[]) {
  return statuses.map(status => ({ status }))
}

describe('deriveTerminalRunOutcome', () => {
  test('all completed attempts are successful', () => {
    expect(deriveTerminalRunOutcome(attempts('completed', 'completed'))).toEqual({
      status: 'successful',
      errorCode: null,
      errorMessage: null,
    })
  })

  test.each([
    { label: 'completed plus needs_review', statuses: ['completed', 'needs_review'] },
    { label: 'only needs_review', statuses: ['needs_review'] },
  ] as const)('review-only outcomes become awaiting_review: $label', ({ statuses }) => {
    expect(deriveTerminalRunOutcome(attempts(...statuses))).toEqual({
      status: 'awaiting_review',
      errorCode: 'RUN_REVIEW_REQUIRED',
      errorMessage: 'One or more attempts require review',
    })
  })

  test.each([
    { label: 'completed plus failed', statuses: ['completed', 'failed'] },
    { label: 'completed plus timed_out', statuses: ['completed', 'timed_out'] },
    { label: 'completed plus interrupted', statuses: ['completed', 'interrupted'] },
    { label: 'needs_review plus failed', statuses: ['needs_review', 'failed'] },
    { label: 'needs_review plus timed_out', statuses: ['needs_review', 'timed_out'] },
    { label: 'needs_review plus interrupted', statuses: ['needs_review', 'interrupted'] },
    { label: 'completed plus needs_review plus failed', statuses: ['completed', 'needs_review', 'failed'] },
  ] as const)('mixed terminal outcomes become partially_successful: $label', ({ statuses }) => {
    expect(deriveTerminalRunOutcome(attempts(...statuses))).toEqual({
      status: 'partially_successful',
      errorCode: 'RUN_PARTIALLY_SUCCESSFUL',
      errorMessage: 'Run completed with mixed attempt outcomes',
    })
  })

  test('hard failures without any completed or reviewable attempt become failed', () => {
    expect(deriveTerminalRunOutcome(attempts('failed', 'timed_out'))).toEqual({
      status: 'failed',
      errorCode: 'RUN_ATTEMPT_FAILED',
      errorMessage: 'One or more attempts failed or timed out',
    })
  })

  test('only interrupted attempts become interrupted', () => {
    expect(deriveTerminalRunOutcome(attempts('interrupted'))).toEqual({
      status: 'interrupted',
      errorCode: 'RUN_INTERRUPTED',
      errorMessage: 'Run was interrupted before any attempt completed',
    })
  })

  test('cancelled attempts stay owned by the service cancellation path', () => {
    expectBoundaryError(
      () => deriveTerminalRunOutcome(attempts('completed', 'cancelled')),
      'VALIDATION_ERROR',
      'Cancelled attempts must be resolved by the run cancellation owner before deriving terminal status',
    )
  })

  test('empty attempt results are rejected explicitly', () => {
    expectBoundaryError(
      () => deriveTerminalRunOutcome([]),
      'VALIDATION_ERROR',
      'Cannot derive a terminal run outcome without attempt results',
    )
  })

  test.each([
    { label: 'cancelled only', statuses: ['cancelled'] },
    { label: 'completed plus cancelled', statuses: ['completed', 'cancelled'] },
  ] as const)('cancelled input stays service-owned: $label', ({ statuses }) => {
    expectBoundaryError(
      () => deriveTerminalRunOutcome(attempts(...statuses)),
      'VALIDATION_ERROR',
      'Cancelled attempts must be resolved by the run cancellation owner before deriving terminal status',
    )
  })

  test.each([
    {
      label: 'pending only',
      statuses: ['pending'],
      message: 'Cannot derive a terminal run outcome from nonterminal attempt statuses: pending',
    },
    {
      label: 'provisioning only',
      statuses: ['provisioning'],
      message: 'Cannot derive a terminal run outcome from nonterminal attempt statuses: provisioning',
    },
    {
      label: 'running mixed with completed',
      statuses: ['running', 'completed'],
      message: 'Cannot derive a terminal run outcome from nonterminal attempt statuses: running',
    },
  ] as const)('nonterminal inputs are rejected explicitly: $label', ({ message, statuses }) => {
    expectBoundaryError(
      () => deriveTerminalRunOutcome(attempts(...statuses)),
      'VALIDATION_ERROR',
      message,
    )
  })
})

function expectBoundaryError(
  action: () => unknown,
  code: RuntimeServiceError['code'],
  message: string,
) {
  try {
    action()
    throw new Error('expected deriveTerminalRunOutcome to throw')
  } catch (error) {
    expect(error).toBeInstanceOf(RuntimeServiceError)
    expect(error).toMatchObject({ code, message })
  }
}

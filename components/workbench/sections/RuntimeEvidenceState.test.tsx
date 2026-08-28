import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  RuntimeEvidenceState,
  runtimeEvidenceMetricValue,
} from './RuntimeEvidenceState'

describe('RuntimeEvidenceState', () => {
  test('renders loading copy instead of empty copy when evidence is still pending', () => {
    const markup = renderToStaticMarkup(
      <RuntimeEvidenceState
        kind="trace"
        label="Trace"
        error={null}
        isLoading
        isEmpty={false}
        emptyMessage="No trace events recorded yet."
      >
        <span>step-started</span>
      </RuntimeEvidenceState>,
    )

    expect(markup).toContain('Loading trace evidence…')
    expect(markup).not.toContain('No trace events recorded yet.')
    expect(markup).not.toContain('step-started')
  })

  test('renders trace evidence as unavailable with typed error details', () => {
    const error = Object.assign(new Error('trace index unavailable'), {
      code: 'TRACE_QUERY_FAILED',
    })
    const markup = renderToStaticMarkup(
      <RuntimeEvidenceState
        kind="trace"
        label="Trace"
        error={error}
        isEmpty={false}
        emptyMessage="No trace events recorded yet."
      >
        <span>step-started</span>
      </RuntimeEvidenceState>,
    )

    expect(markup).toContain('Trace evidence unavailable.')
    expect(markup).toContain('TRACE_QUERY_FAILED')
    expect(markup).toContain('trace index unavailable')
    expect(markup).toContain('data-testid="run-trace-events-error"')
    expect(markup).not.toContain('No trace events recorded yet.')
    expect(markup).not.toContain('step-started')
  })

  test('renders approval evidence as unavailable with typed error details', () => {
    const error = Object.assign(new Error('approval ledger offline'), {
      code: 'APPROVAL_QUERY_FAILED',
    })
    const markup = renderToStaticMarkup(
      <RuntimeEvidenceState
        kind="approval"
        label="Approval"
        error={error}
        isEmpty={false}
        emptyMessage="No approvals recorded yet."
      >
        <span>reveal</span>
      </RuntimeEvidenceState>,
    )

    expect(markup).toContain('Approval evidence unavailable.')
    expect(markup).toContain('APPROVAL_QUERY_FAILED')
    expect(markup).toContain('approval ledger offline')
    expect(markup).toContain('data-testid="run-approval-events-error"')
    expect(markup).not.toContain('No approvals recorded yet.')
    expect(markup).not.toContain('reveal')
  })

  test('renders the true empty state when no evidence records exist', () => {
    const markup = renderToStaticMarkup(
      <RuntimeEvidenceState
        kind="trace"
        label="Trace"
        error={null}
        isEmpty
        emptyMessage="No trace events recorded yet."
      >
        <span>step-started</span>
      </RuntimeEvidenceState>,
    )

    expect(markup).toContain('No trace events recorded yet.')
    expect(markup).not.toContain('Trace evidence unavailable.')
    expect(markup).not.toContain('step-started')
  })

  test('renders normal evidence entries and authoritative counts when data is available', () => {
    const traceMarkup = renderToStaticMarkup(
      <RuntimeEvidenceState
        kind="trace"
        label="Trace"
        error={null}
        isEmpty={false}
        emptyMessage="No trace events recorded yet."
      >
        <span>step-started</span>
      </RuntimeEvidenceState>,
    )
    const approvalMarkup = renderToStaticMarkup(
      <RuntimeEvidenceState
        kind="approval"
        label="Approval"
        error={null}
        isEmpty={false}
        emptyMessage="No approvals recorded yet."
      >
        <span>reveal</span>
      </RuntimeEvidenceState>,
    )

    expect(traceMarkup).toContain('step-started')
    expect(approvalMarkup).toContain('reveal')
    expect(runtimeEvidenceMetricValue([{ event_type: 'step-started' }], null)).toBe(1)
    expect(runtimeEvidenceMetricValue([{ id: 'apr-1' }], null)).toBe(1)
    expect(runtimeEvidenceMetricValue(undefined, null, true)).toBe('Loading')
    expect(runtimeEvidenceMetricValue([], Object.assign(new Error('broken'), { code: 'ERR' }))).toBe('Unavailable')
  })
})

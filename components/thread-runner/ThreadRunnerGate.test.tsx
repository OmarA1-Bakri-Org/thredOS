import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ThreadRunnerGate } from './ThreadRunnerGate'

describe('ThreadRunnerGate', () => {
  test('renders the gate panel with trophy icon and title', () => {
    const markup = renderToStaticMarkup(<ThreadRunnerGate />)

    expect(markup).toContain('data-testid="thread-runner-gate"')
    expect(markup).toContain('Thread Runner')
  })

  test('renders all three requirement cards', () => {
    const markup = renderToStaticMarkup(<ThreadRunnerGate />)

    expect(markup).toContain('data-testid="thread-runner-requirements"')
    expect(markup).toContain('data-testid="requirement-verified-identity"')
    expect(markup).toContain('data-testid="requirement-vm-access"')
    expect(markup).toContain('data-testid="requirement-active-subscription"')
  })

  test('all requirements show locked status by default', () => {
    const markup = renderToStaticMarkup(<ThreadRunnerGate />)

    // Count locked badges — all three should be locked
    const lockedCount = (markup.match(/Locked/g) || []).length
    expect(lockedCount).toBeGreaterThanOrEqual(3)
  })

  test('renders disabled Check Eligibility button', () => {
    const markup = renderToStaticMarkup(<ThreadRunnerGate />)

    expect(markup).toContain('data-testid="check-eligibility-btn"')
    expect(markup).toContain('disabled')
    expect(markup).toContain('Check Eligibility')
  })

  test('displays requirement descriptions', () => {
    const markup = renderToStaticMarkup(<ThreadRunnerGate />)

    expect(markup).toContain('verified ThreadOS identity')
    expect(markup).toContain('sandboxed execution')
    expect(markup).toContain('paid subscription')
  })
})

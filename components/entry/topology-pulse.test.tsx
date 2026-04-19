import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import { TopologyPulse } from './topology-pulse'

describe('TopologyPulse', () => {
  test('renders the static gradient track regardless of motion preference', () => {
    const html = renderToStaticMarkup(React.createElement(TopologyPulse))
    expect(html).toContain('from-transparent')
    expect(html).toContain('via-sky-400/70')
    expect(html).toContain('to-transparent')
    // aria-hidden so screen readers skip the purely decorative element
    expect(html).toContain('aria-hidden="true"')
  })

  test('accepts direction and delay without crashing', () => {
    expect(() =>
      renderToStaticMarkup(
        React.createElement(TopologyPulse, { direction: 'up', delay: 1.2 }),
      ),
    ).not.toThrow()
  })
})

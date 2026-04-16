import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

const { ProductEntryScreenClient } = await import('./ProductEntryScreenClient')

describe('ProductEntryScreenClient', () => {
  test('renders preview badge and variant attributes for coded concept review', () => {
    const markup = renderToStaticMarkup(
      <ProductEntryScreenClient
        isHostedMode
        uiVariant="premium-control"
        previewMode
        primaryHref="/app?uiVariant=premium-control&preview=1"
      />,
    )

    expect(markup).toContain('data-ui-variant="premium-control"')
    expect(markup).toContain('data-ui-preview="true"')
    expect(markup).toContain('Preview B · Premium Control Surface')
    expect(markup).toContain('Premium Control Surface')
  })
})

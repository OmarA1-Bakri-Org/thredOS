import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

const DesignReviewPage = (await import('./page')).default

describe('design review page', () => {
  test('renders three coded preview variants and hard gate copy', () => {
    const markup = renderToStaticMarkup(<DesignReviewPage />)
    expect(markup).toContain('Hard gate — choose one before rollout')
    expect(markup).toContain('Operator Minimalism')
    expect(markup).toContain('Premium Control Surface')
    expect(markup).toContain('Industrial Systems UI')
    expect(markup).toContain('/?uiVariant=operator-minimalism&amp;preview=1')
    expect(markup).toContain('/app?uiVariant=premium-control&amp;preview=1')
    expect(markup).toContain('data-testid="design-review-card-industrial-systems"')
  })
})

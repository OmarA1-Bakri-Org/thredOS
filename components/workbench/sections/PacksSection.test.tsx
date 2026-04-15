import { describe, expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('@/lib/ui/api', () => ({
  useListPacks: () => ({
    data: [{
      id: 'hero-pack',
      type: 'hero',
      builderId: 'builder-1',
      builderName: 'Omar',
      division: 'open',
      classification: 'launch',
      acquiredAt: '2026-04-15T00:00:00.000Z',
      highestStatus: 'hero',
      statusHistory: [{ status: 'hero', achievedAt: '2026-04-15T00:00:00.000Z', context: 'Won' }],
    }],
    isLoading: false,
  }),
  useInstallPack: () => ({
    mutate: () => {}, mutateAsync: async () => ({ installedPack: { packId: 'hero-pack', version: '1.0.0' } }),
    isPending: false,
  }),
}))

const { PacksSection } = await import('./PacksSection')

describe('PacksSection', () => {
  test('renders a manual install form alongside pack cards', () => {
    const markup = renderToStaticMarkup(<PacksSection />)
    expect(markup).toContain('data-testid="pack-install-form"')
    expect(markup).toContain('placeholder="pack id"')
    expect(markup).toContain('placeholder="version"')
    expect(markup).toContain('Install Pack')
    expect(markup).toContain('data-testid="pack-card-hero-pack"')
  })
})

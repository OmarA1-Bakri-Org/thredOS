import { ProductEntryScreen } from '@/components/entry/ProductEntryScreen'
import { getServerSession } from '@/lib/auth/session'
import { isHostedMode } from '@/lib/hosted'
import { resolvePreviewMode, resolveUiVariant, takeFirstQueryValue } from '@/lib/ui/design-variants'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function buildPrimaryHref({
  isAuthenticated,
  hostedMode,
  uiVariant,
  previewMode,
}: {
  isAuthenticated: boolean
  hostedMode: boolean
  uiVariant: string
  previewMode: boolean
}) {
  const hasVariantQuery = previewMode || uiVariant !== 'operator-minimalism'
  const variantSuffix = hasVariantQuery ? `uiVariant=${uiVariant}${previewMode ? '&preview=1' : ''}` : ''
  const appHref = variantSuffix ? `/app?${variantSuffix}` : '/app'
  if (isAuthenticated) return appHref
  if (hostedMode) return variantSuffix ? `/login?next=${encodeURIComponent(appHref)}&${variantSuffix}` : '/login?next=/app'
  return appHref
}

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const session = await getServerSession()
  const params = await searchParams
  const uiVariant = resolveUiVariant(takeFirstQueryValue(params.uiVariant))
  const previewMode = resolvePreviewMode(takeFirstQueryValue(params.preview))
  const hostedMode = isHostedMode()

  return (
    <ProductEntryScreen
      isHostedMode={hostedMode}
      isAuthenticated={!!session}
      primaryHref={buildPrimaryHref({
        isAuthenticated: !!session,
        hostedMode,
        uiVariant,
        previewMode,
      })}
      uiVariant={uiVariant}
      previewMode={previewMode}
    />
  )
}

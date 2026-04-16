import { redirect } from 'next/navigation'
import { ThredOSApp } from '@/components/app/ThreadOSApp'
import { resolvePreviewMode, resolveUiVariant, takeFirstQueryValue } from '@/lib/ui/design-variants'
import { getServerSession } from '@/lib/auth/session'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function buildLoginHref(uiVariant: string, previewMode: boolean) {
  const hasVariantQuery = previewMode || uiVariant !== 'operator-minimalism'
  const appHref = hasVariantQuery ? `/app?uiVariant=${uiVariant}${previewMode ? '&preview=1' : ''}` : '/app'
  return hasVariantQuery
    ? `/login?next=${encodeURIComponent(appHref)}&uiVariant=${uiVariant}${previewMode ? '&preview=1' : ''}`
    : '/login?next=/app'
}

export default async function ThredOSPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await getServerSession()
  const params = await searchParams
  const uiVariant = resolveUiVariant(takeFirstQueryValue(params.uiVariant))
  const previewMode = resolvePreviewMode(takeFirstQueryValue(params.preview))

  if (!session) {
    redirect(buildLoginHref(uiVariant, previewMode))
  }

  return <ThredOSApp uiVariant={uiVariant} previewMode={previewMode} />
}

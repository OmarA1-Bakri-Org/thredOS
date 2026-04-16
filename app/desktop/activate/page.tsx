import { Suspense } from 'react'
import { DesktopActivateClient } from '@/components/desktop/DesktopActivateClient'
import { resolvePreviewMode, resolveUiVariant, takeFirstQueryValue } from '@/lib/ui/design-variants'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function DesktopActivatePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const uiVariant = resolveUiVariant(takeFirstQueryValue(params.uiVariant))
  const previewMode = resolvePreviewMode(takeFirstQueryValue(params.preview))

  return (
    <Suspense fallback={<div className="min-h-screen bg-[#060a12]" />}>
      <DesktopActivateClient uiVariant={uiVariant} previewMode={previewMode} />
    </Suspense>
  )
}

import type { ReactNode } from 'react'
import type { UiVariant } from '@/lib/ui/design-variants'
import { ProductEntryScreenClient } from './ProductEntryScreenClient'

export interface ProductEntryScreenProps {
  isHostedMode?: boolean
  isAuthenticated?: boolean
  primaryHref?: string
  onEnterThredOS?: () => void
  onEnterThreadOS?: () => void
  uiVariant?: UiVariant
  previewMode?: boolean
}

export function ProductEntryScreen(props: ProductEntryScreenProps): ReactNode {
  return <ProductEntryScreenClient {...props} />
}

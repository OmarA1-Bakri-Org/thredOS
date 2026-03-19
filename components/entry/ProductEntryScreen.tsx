import type { ReactNode } from 'react'
import { ProductEntryScreenClient } from './ProductEntryScreenClient'

export interface ProductEntryScreenProps {
  isHostedMode?: boolean
  isAuthenticated?: boolean
  primaryHref?: string
  onEnterThredOS?: () => void
  onEnterThreadOS?: () => void
}

export function ProductEntryScreen(props: ProductEntryScreenProps): ReactNode {
  return <ProductEntryScreenClient {...props} />
}

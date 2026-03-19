import { ProductEntryScreen } from '@/components/entry/ProductEntryScreen'
import { getServerSession } from '@/lib/auth/session'
import { isHostedMode } from '@/lib/hosted'

export default async function Home() {
  const session = await getServerSession()

  return (
    <ProductEntryScreen
      isHostedMode={isHostedMode()}
      isAuthenticated={!!session}
      primaryHref={session ? '/app' : isHostedMode() ? '/login?next=/app' : '/app'}
    />
  )
}

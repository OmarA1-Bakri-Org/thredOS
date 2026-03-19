import { redirect } from 'next/navigation'
import { ThredOSApp } from '@/components/app/ThreadOSApp'
import { getServerSession } from '@/lib/auth/session'

export default async function ThredOSPage() {
  const session = await getServerSession()
  if (!session) {
    redirect('/login?next=/app')
  }

  return <ThredOSApp />
}

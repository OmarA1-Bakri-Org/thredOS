import { Suspense } from 'react'
import { DesktopActivateClient } from '@/components/desktop/DesktopActivateClient'

export default function DesktopActivatePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#060a12]" />}>
      <DesktopActivateClient />
    </Suspense>
  )
}

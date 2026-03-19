import type { Metadata } from 'next'
import { Providers } from '@/lib/ui/providers'
import './globals.css'

export const metadata: Metadata = {
  title: 'thredOS',
  description: 'AI Agent Orchestration',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}

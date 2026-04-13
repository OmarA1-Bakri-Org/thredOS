import type { Metadata } from 'next'
import { Providers } from '@/lib/ui/providers'
import './globals.css'

function resolveMetadataBase(): URL {
  const candidates = [
    process.env.THREDOS_METADATA_BASE,
    process.env.NEXT_PUBLIC_THREDOS_APP_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
  ]

  const rawOrigin = candidates.find(c => c && c.trim() !== '') ?? 'http://localhost:3000'
  const normalizedOrigin = rawOrigin.startsWith('http')
    ? rawOrigin
    : `https://${rawOrigin}`

  try {
    return new URL(normalizedOrigin)
  } catch {
    return new URL('http://localhost:3000')
  }
}

export const metadata: Metadata = {
  title: 'thredOS Desktop',
  description: 'Local-first control surface for agent work.',
  metadataBase: resolveMetadataBase(),
  icons: {
    icon: '/thredOS.png',
    shortcut: '/thredOS.png',
    apple: '/thredOS.png',
  },
  openGraph: {
    title: 'thredOS Desktop',
    description: 'Local-first control surface for agent work.',
    images: ['/thredOS.png'],
  },
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
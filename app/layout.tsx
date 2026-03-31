import type { Metadata } from 'next'
import { Providers } from '@/lib/ui/providers'
import './globals.css'

export const metadata: Metadata = {
  title: 'thredOS Desktop',
  description: 'Local-first control surface for agent work.',
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

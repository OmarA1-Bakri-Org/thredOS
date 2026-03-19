import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import type { ActivationSession } from '@/lib/local-first/types'

function withParams(baseUrl: string, params: Record<string, string>): string {
  const url = new URL(baseUrl)
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
  return url.toString()
}

export async function POST(request: NextRequest) {
  const state = randomUUID()
  const origin = request.nextUrl.origin
  const returnUrl = process.env.THREDOS_DESKTOP_RETURN_URL
    ?? process.env.THREADOS_DESKTOP_RETURN_URL
    ?? 'thredos://activate'
  const localAppUrl = process.env.THREDOS_DESKTOP_APP_URL ?? 'http://127.0.0.1:3010/app'
  const authBaseUrl = process.env.THREDOS_DESKTOP_AUTH_URL ?? `${origin}/login`

  const session: ActivationSession = {
    state,
    authUrl: withParams(authBaseUrl, {
      state,
      return_to: returnUrl,
      local_app: localAppUrl,
      source: 'desktop',
    }),
    checkoutUrl: null,
    returnUrl,
    localAppUrl,
  }

  return NextResponse.json(session)
}

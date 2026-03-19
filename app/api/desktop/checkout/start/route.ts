import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { ActivationSession } from '@/lib/local-first/types'

const BodySchema = z.object({
  email: z.string().email().optional(),
  plan: z.literal('desktop-public-beta').optional(),
})

function withParams(baseUrl: string, params: Record<string, string>): string {
  const url = new URL(baseUrl)
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
  return url.toString()
}

export async function POST(request: NextRequest) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map(issue => issue.message).join(', ') }, { status: 400 })
  }

  const { email, plan = 'desktop-public-beta' } = parsed.data
  const state = randomUUID()
  const origin = request.nextUrl.origin
  const returnUrl = process.env.THREDOS_DESKTOP_RETURN_URL
    ?? process.env.THREADOS_DESKTOP_RETURN_URL
    ?? 'thredos://activate'
  const localAppUrl = process.env.THREDOS_DESKTOP_APP_URL ?? 'http://127.0.0.1:3010/app'
  const checkoutBaseUrl = process.env.THREDOS_DESKTOP_CHECKOUT_URL ?? `${origin}/login`

  const session: ActivationSession = {
    state,
    authUrl: withParams(`${origin}/login`, {
      state,
      return_to: returnUrl,
      local_app: localAppUrl,
      source: 'desktop',
    }),
    checkoutUrl: withParams(checkoutBaseUrl, {
      state,
      return_to: returnUrl,
      local_app: localAppUrl,
      source: 'desktop',
      checkout: '1',
      plan,
      ...(email ? { email } : {}),
    }),
    returnUrl,
    localAppUrl,
  }

  return NextResponse.json(session)
}

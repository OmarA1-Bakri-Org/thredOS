import { NextResponse } from 'next/server'
import { getBasePath } from '@/lib/config'
import { requireRequestSession } from '@/lib/api-helpers'
import { applyRateLimit } from '@/lib/rate-limit'
import {
  getEffectiveEntitlementState,
  readLocalEntitlement,
  refreshLocalEntitlement,
} from '@/lib/local-first/entitlements'

export async function GET(request: Request) {
  const session = requireRequestSession(request)
  if (session instanceof NextResponse) return session

  const state = await readLocalEntitlement(getBasePath())
  return NextResponse.json(getEffectiveEntitlementState(state))
}

export async function POST(request: Request) {
  const session = requireRequestSession(request)
  if (session instanceof NextResponse) return session
  const rateLimited = applyRateLimit(request, {
    bucket: 'desktop-entitlement-refresh',
    limit: 30,
    windowMs: 5 * 60 * 1000,
  })
  if (rateLimited) return rateLimited

  const state = await refreshLocalEntitlement(getBasePath())
  return NextResponse.json(getEffectiveEntitlementState(state))
}

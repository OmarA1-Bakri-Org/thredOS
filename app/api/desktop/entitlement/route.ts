import { NextResponse } from 'next/server'
import { getBasePath } from '@/lib/config'
import { requireRequestSession } from '@/lib/api-helpers'
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

  const state = await refreshLocalEntitlement(getBasePath())
  return NextResponse.json(getEffectiveEntitlementState(state))
}

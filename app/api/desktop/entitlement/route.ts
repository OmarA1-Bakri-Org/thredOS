import { NextResponse } from 'next/server'
import { getBasePath } from '@/lib/config'
import {
  getEffectiveEntitlementState,
  readLocalEntitlement,
  refreshLocalEntitlement,
} from '@/lib/local-first/entitlements'

export async function GET() {
  const state = await readLocalEntitlement(getBasePath())
  return NextResponse.json(getEffectiveEntitlementState(state))
}

export async function POST() {
  const state = await refreshLocalEntitlement(getBasePath())
  return NextResponse.json(getEffectiveEntitlementState(state))
}

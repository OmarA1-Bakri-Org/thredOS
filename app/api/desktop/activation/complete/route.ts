import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getBasePath } from '@/lib/config'
import {
  activateLocalEntitlement,
  getEffectiveEntitlementState,
  verifyActivationToken,
} from '@/lib/local-first/entitlements'

const BodySchema = z.object({
  token: z.string().min(1),
})

export async function POST(request: Request) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Activation token is required' }, { status: 400 })
  }

  const payload = verifyActivationToken(parsed.data.token)
  if (!payload) {
    return NextResponse.json({ error: 'Invalid activation token' }, { status: 400 })
  }

  const state = await activateLocalEntitlement(getBasePath(), payload)
  const snapshot = getEffectiveEntitlementState(state)
  return NextResponse.json(snapshot)
}

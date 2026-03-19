import { NextResponse } from 'next/server'
import { isHostedMode } from '@/lib/hosted'

export async function GET() {
  return NextResponse.json({
    ok: true,
    hostedMode: isHostedMode(),
    timestamp: new Date().toISOString(),
  })
}

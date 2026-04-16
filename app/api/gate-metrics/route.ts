import { getBasePath } from '@/lib/config'
import * as audit from '@/lib/audit/logger'
import { computeGateMetrics, type GateAuditEntry } from '@/lib/gates/metrics'
import { requireRequestSession } from '@/lib/api-helpers'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const url = new URL(request.url)
    const gateId = url.searchParams.get('gateId')
    if (!gateId) {
      return NextResponse.json({ error: 'Missing gateId query parameter' }, { status: 400 })
    }
    const bp = getBasePath()
    const auditEntries = await audit.readAll(bp)

    const gateAuditEntries: GateAuditEntry[] = auditEntries
      .filter(e => e.action === 'gate approve' || e.action === 'gate.approve' || e.action === 'gate block' || e.action === 'gate.block')
      .map(e => ({
        action: e.action,
        gateId: String(e.target),
        timestamp: e.timestamp,
      }))

    const metrics = computeGateMetrics(gateId, gateAuditEntries)
    return NextResponse.json({ metrics })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

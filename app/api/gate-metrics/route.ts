import { getBasePath } from '@/lib/config'
import * as audit from '@/lib/audit/logger'
import { computeGateMetrics, type GateAuditEntry } from '@/lib/gates/metrics'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const gateId = url.searchParams.get('gateId')
    if (!gateId) {
      return Response.json({ error: 'Missing gateId query parameter' }, { status: 400 })
    }
    const bp = getBasePath()
    const auditEntries = await audit.readAll(bp)

    const gateAuditEntries: GateAuditEntry[] = auditEntries
      .filter(e => e.action === 'gate approve' || e.action === 'gate block')
      .map(e => ({
        action: e.action,
        gateId: String(e.target),
        timestamp: e.timestamp,
      }))

    const metrics = computeGateMetrics(gateId, gateAuditEntries)
    return Response.json({ metrics })
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

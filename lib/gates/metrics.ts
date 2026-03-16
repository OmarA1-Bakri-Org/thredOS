export interface GateAuditEntry {
  action: string
  gateId: string
  timestamp: string
}

export interface GateMetrics {
  totalAttempts: number
  approvalRate: number
  avgTimeToApprovalMs: number
  approvals: number
  blocks: number
}

export function computeGateMetrics(gateId: string, entries: GateAuditEntry[]): GateMetrics {
  const gateEntries = entries.filter(e => e.gateId === gateId)
  if (gateEntries.length === 0) {
    return { totalAttempts: 0, approvalRate: 0, avgTimeToApprovalMs: 0, approvals: 0, blocks: 0 }
  }
  const approvals = gateEntries.filter(e => e.action === 'gate approve').length
  const blocks = gateEntries.filter(e => e.action === 'gate block').length
  const totalAttempts = approvals + blocks
  const approvalRate = totalAttempts > 0 ? Math.round((approvals / totalAttempts) * 100) : 0

  const sorted = [...gateEntries].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  let totalTimeMs = 0
  let cycleCount = 0
  let lastBlockTime: number | null = null
  for (const entry of sorted) {
    if (entry.action === 'gate block') {
      lastBlockTime = new Date(entry.timestamp).getTime()
    } else if (entry.action === 'gate approve' && lastBlockTime !== null) {
      totalTimeMs += new Date(entry.timestamp).getTime() - lastBlockTime
      cycleCount++
      lastBlockTime = null
    }
  }
  const avgTimeToApprovalMs = cycleCount > 0 ? Math.round(totalTimeMs / cycleCount) : 0

  return { totalAttempts, approvalRate, avgTimeToApprovalMs, approvals, blocks }
}

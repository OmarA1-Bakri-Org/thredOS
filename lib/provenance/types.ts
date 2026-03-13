export interface ProvenanceRecord {
  id: string
  agentId: string
  threadSurfaceId: string
  action: string
  timestamp: string
  metadata?: Record<string, unknown>
}

export interface ProvenanceState {
  version: 1
  records: ProvenanceRecord[]
}

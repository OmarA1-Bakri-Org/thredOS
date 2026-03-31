import { readFile } from 'fs/promises'
import { join } from 'path'
import { readTraceEvents } from '@/lib/traces/reader'
import { readGateDecisions } from '@/lib/gates/repository'
import { readApprovals } from '@/lib/approvals/repository'
import type { ExportBundle } from './schema'

export async function generateExportBundle(basePath: string, runId: string): Promise<ExportBundle> {
  // Read sequence snapshot
  let sequenceSnapshot = ''
  try { sequenceSnapshot = await readFile(join(basePath, '.threados/sequence.yaml'), 'utf-8') } catch { /* empty */ }

  // Read policy snapshot
  let policySnapshot: string | null = null
  try { policySnapshot = await readFile(join(basePath, '.threados/policy.yaml'), 'utf-8') } catch { /* empty */ }

  // Read run artifacts
  const traceEvents = await readTraceEvents(basePath, runId)
  const gateDecisions = await readGateDecisions(basePath, runId)
  const approvals = await readApprovals(basePath, runId)

  return {
    bundle_version: '1.0',
    run_id: runId,
    pack: { id: null, version: null },
    sequence_snapshot: sequenceSnapshot,
    policy_snapshot: policySnapshot,
    surfaces: [],
    trace_events: traceEvents,
    gate_decisions: gateDecisions,
    approvals,
    artifact_manifests: [],
    timing_summary: null,
    cost_summary: null,
    exported_at: new Date().toISOString(),
  }
}

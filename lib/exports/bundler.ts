import { readdir, readFile } from 'fs/promises'
import { join, relative } from 'path'
import { readTraceEvents } from '@/lib/traces/reader'
import { readGateDecisions } from '@/lib/gates/repository'
import { readApprovals } from '@/lib/approvals/repository'
import { readThreadSurfaceState } from '@/lib/thread-surfaces/repository'
import type { StatusJson } from '@/lib/runner/artifacts'
import type { ExportBundle } from './schema'

const FILE_SAFE_RUN_ID = /^[A-Za-z0-9._-]+$/

function assertSafeRunId(runId: string) {
  if (!FILE_SAFE_RUN_ID.test(runId)) {
    throw new Error('runId must be a file-safe identifier')
  }
}

async function collectArtifactManifests(runDir: string): Promise<string[]> {
  try {
    const entries = await readdir(runDir, { withFileTypes: true })
    const manifests = await Promise.all(entries.map(async entry => {
      const entryPath = join(runDir, entry.name)
      if (entry.isDirectory()) {
        return await collectArtifactManifests(entryPath)
      }
      return [entryPath]
    }))
    return manifests.flat().sort((left, right) => left.localeCompare(right))
  } catch {
    return []
  }
}

async function collectStepStatuses(runDir: string): Promise<StatusJson[]> {
  const manifests = await collectArtifactManifests(runDir)
  const statusPaths = manifests.filter(path => path.endsWith('status.json'))
  const statuses = await Promise.all(statusPaths.map(async path => {
    try {
      return JSON.parse(await readFile(path, 'utf-8')) as StatusJson
    } catch {
      return null
    }
  }))
  return statuses.filter((status): status is StatusJson => status != null)
}

function summarizeTiming(statuses: StatusJson[]) {
  if (statuses.length === 0) return null

  const totalDurationMs = statuses.reduce((sum, status) => sum + status.duration, 0)
  const startTimes = statuses.map(status => Date.parse(status.startTime)).filter(Number.isFinite)
  const endTimes = statuses.map(status => Date.parse(status.endTime)).filter(Number.isFinite)

  return {
    stepCount: statuses.length,
    totalDurationMs,
    longestStepMs: Math.max(...statuses.map(status => status.duration)),
    failedSteps: statuses.filter(status => status.status !== 'SUCCESS').length,
    successfulSteps: statuses.filter(status => status.status === 'SUCCESS').length,
    startedAt: startTimes.length > 0 ? new Date(Math.min(...startTimes)).toISOString() : null,
    endedAt: endTimes.length > 0 ? new Date(Math.max(...endTimes)).toISOString() : null,
  }
}

export async function generateExportBundle(basePath: string, runId: string): Promise<ExportBundle> {
  assertSafeRunId(runId)

  // Read sequence snapshot
  let sequenceSnapshot = ''
  try { sequenceSnapshot = await readFile(join(basePath, '.threados/sequence.yaml'), 'utf-8') } catch { /* empty */ }

  // Read policy snapshot
  let policySnapshot: string | null = null
  try { policySnapshot = await readFile(join(basePath, '.threados/policy.yaml'), 'utf-8') } catch { /* empty */ }

  // Read run artifacts
  const runDir = join(basePath, '.threados/runs', runId)
  const traceEvents = await readTraceEvents(basePath, runId)
  const gateDecisions = await readGateDecisions(basePath, runId)
  const approvals = await readApprovals(basePath, runId)
  const surfaceState = await readThreadSurfaceState(basePath)
  const artifactManifestPaths = await collectArtifactManifests(runDir)
  const stepStatuses = await collectStepStatuses(runDir)

  return {
    bundle_version: '1.0',
    run_id: runId,
    pack: { id: null, version: null },
    sequence_snapshot: sequenceSnapshot,
    policy_snapshot: policySnapshot,
    surfaces: surfaceState.threadSurfaces,
    trace_events: traceEvents,
    gate_decisions: gateDecisions,
    approvals,
    artifact_manifests: artifactManifestPaths.map(path => relative(basePath, path)),
    timing_summary: summarizeTiming(stepStatuses),
    cost_summary: null,
    exported_at: new Date().toISOString(),
  }
}

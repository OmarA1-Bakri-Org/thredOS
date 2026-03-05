import { NextResponse } from 'next/server'
import { readSequence } from '@/lib/sequence/parser'
import { readMprocsMap } from '@/lib/mprocs/state'
import { getBasePath } from '@/lib/config'
import { handleError } from '@/lib/api-helpers'
import type { Sequence } from '@/lib/sequence/schema'

function buildStatus(sequence: Sequence, mprocsMap: Record<string, number>) {
  const summary = { total: sequence.steps.length, ready: 0, running: 0, done: 0, failed: 0, blocked: 0, needsReview: 0 }
  for (const s of sequence.steps) {
    if (s.status === 'READY') summary.ready++
    else if (s.status === 'RUNNING') summary.running++
    else if (s.status === 'DONE') summary.done++
    else if (s.status === 'FAILED') summary.failed++
    else if (s.status === 'BLOCKED') summary.blocked++
    else if (s.status === 'NEEDS_REVIEW') summary.needsReview++
  }
  return {
    name: sequence.name,
    version: sequence.version,
    steps: sequence.steps.map(s => ({
      id: s.id, name: s.name, type: s.type, status: s.status,
      model: s.model, dependsOn: s.depends_on, processIndex: mprocsMap[s.id],
      groupId: s.group_id, fusionCandidates: s.fusion_candidates, fusionSynth: s.fusion_synth,
    })),
    gates: sequence.gates.map(g => ({
      id: g.id, name: g.name, status: g.status, dependsOn: g.depends_on,
    })),
    summary,
  }
}

export type SequenceStatus = ReturnType<typeof buildStatus>

export async function GET() {
  try {
    const bp = getBasePath()
    const [sequence, mprocsMap] = await Promise.all([readSequence(bp), readMprocsMap(bp)])
    return NextResponse.json(buildStatus(sequence, mprocsMap))
  } catch (err) {
    return handleError(err)
  }
}

export { buildStatus }

import { NextResponse } from 'next/server'
import { readSequence } from '@/lib/sequence/parser'
import { readMprocsMap } from '@/lib/mprocs/state'
import { getBasePath } from '@/lib/config'
import { handleError, requireRequestSession } from '@/lib/api-helpers'
import type { Sequence, Step } from '@/lib/sequence/schema'

interface StatusSummary {
  total: number
  ready: number
  running: number
  done: number
  failed: number
  blocked: number
  needsReview: number
}

const STATUS_KEYS: Record<string, keyof Omit<StatusSummary, 'total'>> = {
  READY: 'ready',
  RUNNING: 'running',
  DONE: 'done',
  FAILED: 'failed',
  BLOCKED: 'blocked',
  NEEDS_REVIEW: 'needsReview',
}

function buildSummary(steps: Step[]): StatusSummary {
  const summary: StatusSummary = { total: steps.length, ready: 0, running: 0, done: 0, failed: 0, blocked: 0, needsReview: 0 }
  for (const s of steps) {
    const key = STATUS_KEYS[s.status]
    if (key) summary[key]++
  }
  return summary
}

function mapStep(s: Step, mprocsMap: Record<string, number>) {
  return {
    id: s.id, name: s.name, type: s.type, status: s.status,
    model: s.model, dependsOn: s.depends_on, processIndex: mprocsMap[s.id],
    groupId: s.group_id, fusionCandidates: s.fusion_candidates, fusionSynth: s.fusion_synth,
  }
}

function buildStatus(sequence: Sequence, mprocsMap: Record<string, number>) {
  return {
    name: sequence.name,
    version: sequence.version,
    thread_type: sequence.thread_type,
    steps: sequence.steps.map(s => mapStep(s, mprocsMap)),
    gates: sequence.gates.map(g => ({
      id: g.id, name: g.name, status: g.status, dependsOn: g.depends_on,
      description: g.description, acceptance_conditions: g.acceptance_conditions,
      required_review: g.required_review,
    })),
    summary: buildSummary(sequence.steps),
  }
}

export type SequenceStatus = ReturnType<typeof buildStatus>

export async function GET(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const bp = getBasePath()
    const [sequence, mprocsMap] = await Promise.all([readSequence(bp), readMprocsMap(bp)])
    return NextResponse.json(buildStatus(sequence, mprocsMap))
  } catch (err) {
    return handleError(err)
  }
}

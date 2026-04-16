import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { readApprovals, appendApproval } from '@/lib/approvals/repository'
import { getBasePath } from '@/lib/config'
import { handleError, requireRequestSession } from '@/lib/api-helpers'
import { applyRateLimit } from '@/lib/rate-limit'
import { appendTraceEvent } from '@/lib/traces/writer'
import type { Approval } from '@/lib/contracts/schemas'

function foldApprovals(entries: Approval[]): Approval[] {
  const indexById = new Map<string, number>()
  const folded: Approval[] = []

  for (const entry of entries) {
    const existingIndex = indexById.get(entry.id)
    if (existingIndex == null) {
      indexById.set(entry.id, folded.length)
      folded.push(entry)
      continue
    }
    folded[existingIndex] = {
      ...folded[existingIndex],
      ...entry,
    }
  }

  return folded
}

export async function GET(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session

    const { searchParams } = new URL(request.url)
    const runId = searchParams.get('runId')
    if (!runId) {
      return NextResponse.json({ error: 'runId required', code: 'MISSING_PARAM' }, { status: 400 })
    }

    const approvals = foldApprovals(await readApprovals(getBasePath(), runId))
    return NextResponse.json({ approvals })
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const rateLimited = applyRateLimit(request, {
      bucket: 'approvals-write',
      limit: 30,
      windowMs: 5 * 60 * 1000,
    })
    if (rateLimited) return rateLimited

    const body = await request.json()
    const { action, runId } = body
    if (!runId) {
      return NextResponse.json({ error: 'runId required', code: 'MISSING_PARAM' }, { status: 400 })
    }

    const bp = getBasePath()

    if (action === 'request') {
      const approval = {
        id: `apr-${randomUUID()}`,
        action_type: body.action_type ?? 'run',
        target_ref: body.target_ref,
        requested_by: body.requested_by ?? 'threados',
        status: 'pending' as const,
        approved_by: null,
        approved_at: null,
        notes: body.notes ?? null,
      }
      await appendApproval(bp, runId, approval)
      await appendTraceEvent(bp, runId, {
        ts: new Date().toISOString(),
        run_id: runId,
        surface_id: body.target_ref ?? runId,
        actor: 'api:approvals',
        event_type: 'approval-requested',
        payload_ref: null,
        policy_ref: null,
      })
      return NextResponse.json({ approval })
    }

    if (action === 'resolve') {
      const approval = {
        id: body.approval_id ?? `apr-${randomUUID()}`,
        action_type: body.action_type ?? 'run',
        target_ref: body.target_ref,
        requested_by: body.requested_by ?? 'threados',
        status: body.status ?? 'approved',
        approved_by: body.approved_by ?? 'user',
        approved_at: new Date().toISOString(),
        notes: body.notes ?? null,
      }
      await appendApproval(bp, runId, approval)
      await appendTraceEvent(bp, runId, {
        ts: new Date().toISOString(),
        run_id: runId,
        surface_id: body.target_ref ?? runId,
        actor: 'api:approvals',
        event_type: 'approval-resolved',
        payload_ref: null,
        policy_ref: null,
      })
      return NextResponse.json({ approval })
    }

    return NextResponse.json({ error: `Unknown action: ${action}`, code: 'INVALID_ACTION' }, { status: 400 })
  } catch (err) {
    return handleError(err)
  }
}

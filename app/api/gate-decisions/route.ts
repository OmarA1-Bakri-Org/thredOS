import { NextResponse } from 'next/server'
import { getBasePath } from '@/lib/config'
import { handleError, requireRequestSession } from '@/lib/api-helpers'
import { readGateDecisions } from '@/lib/gates/repository'
import { assertSafePathSegment } from '@/lib/security/safe-path'

export async function GET(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session

    const { searchParams } = new URL(request.url)
    const runId = searchParams.get('runId')
    const subjectRef = searchParams.get('subjectRef')
    if (!runId) {
      return NextResponse.json({ error: 'runId query parameter required', code: 'MISSING_PARAM' }, { status: 400 })
    }
    try {
      assertSafePathSegment(runId, 'runId')
    } catch {
      return NextResponse.json({ error: 'runId must be a file-safe identifier', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const decisions = await readGateDecisions(getBasePath(), runId)
    return NextResponse.json({
      decisions: subjectRef ? decisions.filter(decision => decision.subject_ref === subjectRef) : decisions,
    })
  } catch (err) {
    return handleError(err)
  }
}

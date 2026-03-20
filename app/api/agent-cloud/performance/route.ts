import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRequestSession } from '@/lib/api-helpers'
import { getBasePath } from '@/lib/config'
import { listCloudAgentPerformance, recordCloudAgentPerformance } from '@/lib/agents/cloud-registry'
import { applyRateLimit } from '@/lib/rate-limit'

const BodySchema = z.object({
  registrationNumber: z.string().min(1),
  outcome: z.enum(['pass', 'fail', 'needs_review']),
  durationMs: z.number().int().nonnegative().nullable().optional(),
  qualityScore: z.number().int().min(0).max(10).nullable().optional(),
  notes: z.string().nullable().optional(),
})

export async function GET(request: Request) {
  const session = requireRequestSession(request)
  if (session instanceof NextResponse) return session

  const rateLimited = applyRateLimit(request, {
    bucket: 'agent-cloud-performance-read',
    limit: 30,
    windowMs: 5 * 60 * 1000,
  })
  if (rateLimited) return rateLimited

  const registrationNumber = new URL(request.url).searchParams.get('registrationNumber')
  if (!registrationNumber) {
    return NextResponse.json({ error: 'registrationNumber is required' }, { status: 400 })
  }

  const records = await listCloudAgentPerformance(getBasePath(), registrationNumber)
  return NextResponse.json({ records })
}

export async function POST(request: Request) {
  const session = requireRequestSession(request)
  if (session instanceof NextResponse) return session

  const rateLimited = applyRateLimit(request, {
    bucket: 'agent-cloud-performance-write',
    limit: 20,
    windowMs: 5 * 60 * 1000,
  })
  if (rateLimited) return rateLimited

  const parsed = BodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map(issue => issue.message).join(', ') }, { status: 400 })
  }

  const record = await recordCloudAgentPerformance(getBasePath(), {
    registrationNumber: parsed.data.registrationNumber,
    outcome: parsed.data.outcome,
    durationMs: parsed.data.durationMs ?? null,
    qualityScore: parsed.data.qualityScore ?? null,
    notes: parsed.data.notes ?? null,
  })
  return NextResponse.json({ record }, { status: 201 })
}

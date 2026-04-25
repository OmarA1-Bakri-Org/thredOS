import { NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { readSequence, writeSequence } from '@/lib/sequence/parser'
import { validateDAG } from '@/lib/sequence/dag'
import { getBasePath } from '@/lib/config'
import { auditLog, handleError, requireRequestSession } from '@/lib/api-helpers'
import { StepNotFoundError } from '@/lib/errors'
import { applyRateLimit } from '@/lib/rate-limit'

const BodySchema = z.object({ action: z.literal('parallelize'), stepIds: z.array(z.string()).min(2) })

export async function GET(request?: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const seq = await readSequence(getBasePath())
    const groups: Record<string, string[]> = {}
    for (const s of seq.steps) {
      if (s.group_id) { (groups[s.group_id] ??= []).push(s.id) }
    }
    return NextResponse.json({ groups })
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const rateLimited = applyRateLimit(request, {
      bucket: 'group-write',
      limit: 30,
      windowMs: 5 * 60 * 1000,
    })
    if (rateLimited) return rateLimited
    const { stepIds } = BodySchema.parse(await request.json())
    const bp = getBasePath()
    const seq = await readSequence(bp)
    const groupId = `group-${randomUUID().slice(0, 8)}`

    for (const id of stepIds) {
      const step = seq.steps.find(s => s.id === id)
      if (!step) throw new StepNotFoundError(id)
      step.group_id = groupId
      step.type = 'p'
      step.kind = 'p'
    }
    validateDAG(seq)
    await writeSequence(bp, seq)
    await auditLog('group.parallelize', groupId, { stepIds })
    return NextResponse.json({ success: true, action: 'parallelize', groupId, stepIds })
  } catch (err) {
    return handleError(err)
  }
}

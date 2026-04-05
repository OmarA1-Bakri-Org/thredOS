import { NextResponse } from 'next/server'
import { z } from 'zod'
import { readSequence, writeSequence } from '@/lib/sequence/parser'
import { validateDAG } from '@/lib/sequence/dag'
import { getBasePath } from '@/lib/config'
import { auditLog, handleError, requireRequestSession } from '@/lib/api-helpers'
import { StepNotFoundError } from '@/lib/errors'
import { applyRateLimit } from '@/lib/rate-limit'
import type { Step } from '@/lib/sequence/schema'

const BodySchema = z.object({
  action: z.literal('create'),
  candidates: z.array(z.string()).min(2),
  synthId: z.string(),
})

export async function POST(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const rateLimited = applyRateLimit(request, {
      bucket: 'fusion-write',
      limit: 30,
      windowMs: 5 * 60 * 1000,
    })
    if (rateLimited) return rateLimited
    const { candidates, synthId } = BodySchema.parse(await request.json())
    const bp = getBasePath()
    const seq = await readSequence(bp)

    for (const cid of candidates) {
      const step = seq.steps.find(s => s.id === cid)
      if (!step) throw new StepNotFoundError(cid)
      step.fusion_candidates = true
      step.type = 'f'
    }

    if (!seq.steps.some(s => s.id === synthId)) {
      const synth: Step = {
        id: synthId, name: `Fusion synth: ${synthId}`, type: 'f',
        model: 'claude-code', prompt_file: `.threados/prompts/${synthId}.md`,
        depends_on: [...candidates], status: 'READY', fusion_synth: true,
      }
      seq.steps.push(synth)
    } else {
      const existing = seq.steps.find(s => s.id === synthId)!
      existing.fusion_synth = true
      existing.type = 'f'
      for (const cid of candidates) {
        if (!existing.depends_on.includes(cid)) existing.depends_on.push(cid)
      }
    }

    validateDAG(seq)
    await writeSequence(bp, seq)
    await auditLog('fusion.create', synthId, { candidates })
    return NextResponse.json({ success: true, action: 'create', candidates, synthId })
  } catch (err) {
    return handleError(err)
  }
}

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { readSequence, writeSequence } from '@/lib/sequence/parser'
import { getBasePath } from '@/lib/config'
import { handleError, auditLog } from '@/lib/api-helpers'
import type { Sequence } from '@/lib/sequence/schema'

const ResetSchema = z.object({ action: z.literal('reset'), name: z.string().optional() })
const BodySchema = z.union([ResetSchema])

export async function GET() {
  try {
    const sequence = await readSequence(getBasePath())
    return NextResponse.json(sequence)
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(request: Request) {
  try {
    const body = BodySchema.parse(await request.json())
    const bp = getBasePath()

    if (body.action === 'reset') {
      const newSeq: Sequence = {
        version: '1.0',
        name: body.name || 'New Sequence',
        steps: [],
        gates: [],
      }
      await writeSequence(bp, newSeq)
      await auditLog('sequence.reset', body.name || 'New Sequence')
      return NextResponse.json({ success: true, action: 'reset', name: newSeq.name })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    return handleError(err)
  }
}

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { readSequence, writeSequence } from '@/lib/sequence/parser'
import { validateDAG } from '@/lib/sequence/dag'
import { getBasePath } from '@/lib/config'
import { jsonError, auditLog, handleError } from '@/lib/api-helpers'
import { GateNotFoundError } from '@/lib/errors'
import type { Gate } from '@/lib/sequence/schema'

const InsertSchema = z.object({ action: z.literal('insert'), gateId: z.string(), name: z.string().optional(), dependsOn: z.array(z.string()).optional() })
const ApproveSchema = z.object({ action: z.literal('approve'), gateId: z.string() })
const BlockSchema = z.object({ action: z.literal('block'), gateId: z.string() })
const BodySchema = z.union([InsertSchema, ApproveSchema, BlockSchema])

export async function GET() {
  try {
    const seq = await readSequence(getBasePath())
    return NextResponse.json({ gates: seq.gates })
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(request: Request) {
  try {
    const body = BodySchema.parse(await request.json())
    const bp = getBasePath()
    const seq = await readSequence(bp)

    if (body.action === 'insert') {
      if (seq.gates.some(g => g.id === body.gateId)) return jsonError(`Gate '${body.gateId}' already exists`, 'CONFLICT', 409)
      const gate: Gate = { id: body.gateId, name: body.name || body.gateId, depends_on: body.dependsOn || [], status: 'PENDING', cascade: false, childGateIds: [] }
      seq.gates.push(gate)
      validateDAG(seq)
      await writeSequence(bp, seq)
      await auditLog('gate.insert', body.gateId)
      return NextResponse.json({ success: true, action: 'insert', gateId: body.gateId })
    }

    const gate = seq.gates.find(g => g.id === body.gateId)
    if (!gate) throw new GateNotFoundError(body.gateId)

    if (body.action === 'approve') {
      gate.status = 'APPROVED'
      await writeSequence(bp, seq)
      await auditLog('gate.approve', body.gateId)
      return NextResponse.json({ success: true, action: 'approve', gateId: body.gateId })
    }

    gate.status = 'BLOCKED'
    await writeSequence(bp, seq)
    await auditLog('gate.block', body.gateId)
    return NextResponse.json({ success: true, action: 'block', gateId: body.gateId })
  } catch (err) {
    return handleError(err)
  }
}

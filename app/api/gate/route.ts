import { NextResponse } from 'next/server'
import { z } from 'zod'
import { readSequence, writeSequence } from '@/lib/sequence/parser'
import { validateDAG } from '@/lib/sequence/dag'
import { getBasePath } from '@/lib/config'
import { jsonError, auditLog, handleError, requireRequestSession } from '@/lib/api-helpers'
import { applyRateLimit } from '@/lib/rate-limit'
import { GateNotFoundError } from '@/lib/errors'
import type { Gate } from '@/lib/sequence/schema'

const InsertSchema = z.object({ action: z.literal('insert'), gateId: z.string(), name: z.string().optional(), dependsOn: z.array(z.string()).optional() })
const ApproveSchema = z.object({ action: z.literal('approve'), gateId: z.string(), acknowledged_conditions: z.boolean().optional() })
const BlockSchema = z.object({ action: z.literal('block'), gateId: z.string() })
const RmSchema = z.object({ action: z.literal('rm'), gateId: z.string() })
const UpdateSchema = z.object({
  action: z.literal('update'),
  gateId: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  acceptance_conditions: z.array(z.string()).optional(),
  required_review: z.boolean().optional(),
})
const BodySchema = z.union([InsertSchema, ApproveSchema, BlockSchema, RmSchema, UpdateSchema])

export async function GET(request?: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const seq = await readSequence(getBasePath())
    return NextResponse.json({ gates: seq.gates })
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const rateLimited = applyRateLimit(request, {
      bucket: 'gate-write',
      limit: 30,
      windowMs: 5 * 60 * 1000,
    })
    if (rateLimited) return rateLimited
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

    if (body.action === 'rm') {
      const idx = seq.gates.findIndex(g => g.id === body.gateId)
      if (idx === -1) throw new GateNotFoundError(body.gateId)

      const stepDeps = seq.steps.filter(s => s.depends_on.includes(body.gateId))
      const gateDeps = seq.gates.filter(g => g.depends_on.includes(body.gateId))
      if (stepDeps.length > 0 || gateDeps.length > 0) {
        const allDeps = [...stepDeps.map(s => s.id), ...gateDeps.map(g => g.id)]
        return jsonError(`Nodes [${allDeps.join(', ')}] depend on '${body.gateId}'`, 'HAS_DEPENDENTS', 409)
      }

      seq.gates.splice(idx, 1)
      await writeSequence(bp, seq)
      await auditLog('gate.rm', body.gateId)
      return NextResponse.json({ success: true, action: 'rm', gateId: body.gateId })
    }

    const gate = seq.gates.find(g => g.id === body.gateId)
    if (!gate) throw new GateNotFoundError(body.gateId)

    if (body.action === 'update') {
      if (body.name !== undefined) gate.name = body.name
      if (body.description !== undefined) gate.description = body.description
      if (body.acceptance_conditions !== undefined) gate.acceptance_conditions = body.acceptance_conditions
      if (body.required_review !== undefined) gate.required_review = body.required_review
      await writeSequence(bp, seq)
      await auditLog('gate.update', body.gateId)
      return NextResponse.json({ success: true, action: 'update', gateId: body.gateId })
    }

    if (body.action === 'approve') {
      if (gate.required_review && gate.acceptance_conditions?.length) {
        if (!body.acknowledged_conditions) {
          return jsonError('Gate requires review of acceptance conditions before approval', 'APPROVAL_GUARD', 400)
        }
      }
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

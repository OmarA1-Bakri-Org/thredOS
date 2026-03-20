import { NextResponse } from 'next/server'
import { z } from 'zod'
import { readSequence, writeSequence } from '@/lib/sequence/parser'
import { validateDAG } from '@/lib/sequence/dag'
import { getBasePath } from '@/lib/config'
import { jsonError, auditLog, handleError, requireRequestSession } from '@/lib/api-helpers'
import { StepNotFoundError } from '@/lib/errors'
import type { Sequence, Step } from '@/lib/sequence/schema'

const BodySchema = z.union([
  z.object({ action: z.literal('add'), stepId: z.string(), depId: z.string() }),
  z.object({ action: z.literal('rm'), stepId: z.string(), depId: z.string() }),
])

function addDependency(seq: Sequence, step: Step, depId: string): NextResponse | null {
  const exists = seq.steps.some(s => s.id === depId) || seq.gates.some(g => g.id === depId)
  if (!exists) return jsonError(`Node '${depId}' does not exist`, 'NOT_FOUND', 404)
  if (step.depends_on.includes(depId)) return jsonError('Dependency already exists', 'CONFLICT', 409)

  step.depends_on.push(depId)
  try { validateDAG(seq) } catch (e) { step.depends_on.pop(); throw e }
  return null
}

function removeDependency(step: Step, depId: string): NextResponse | null {
  const idx = step.depends_on.indexOf(depId)
  if (idx === -1) return jsonError(`Dependency '${depId}' not found`, 'NOT_FOUND', 404)
  step.depends_on.splice(idx, 1)
  return null
}

export async function POST(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const body = BodySchema.parse(await request.json())
    const bp = getBasePath()
    const seq = await readSequence(bp)
    const step = seq.steps.find(s => s.id === body.stepId)
    if (!step) throw new StepNotFoundError(body.stepId)

    const error = body.action === 'add'
      ? addDependency(seq, step, body.depId)
      : removeDependency(step, body.depId)
    if (error) return error

    await writeSequence(bp, seq)
    await auditLog(`dep.${body.action}`, body.stepId, { depId: body.depId })
    return NextResponse.json({ success: true, action: body.action, stepId: body.stepId, depId: body.depId })
  } catch (err) {
    return handleError(err)
  }
}

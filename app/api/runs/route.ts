import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRequestSession } from '@/lib/api-helpers'
import { getApiRuntimeService, handleRuntimeError, resolveRuntimeContext, runtimeJson } from '@/lib/api/runtime-request'
import { getBasePath } from '@/lib/config'
import { applyRateLimit } from '@/lib/rate-limit'
import { WorkflowRunStatusSchema, WorkflowRunStrategySchema, WorkflowRunTargetSchema } from '@/lib/runtime/schema'

const StartSchema = z.object({
  sequence_id: z.string().min(1),
  target: WorkflowRunTargetSchema,
  strategy: WorkflowRunStrategySchema.default('sequential'),
  max_concurrency: z.number().int().positive().default(1),
  policy_confirmed: z.boolean().optional(),
})

const ListSchema = z.object({
  sequence_id: z.string().min(1).optional(),
  status: WorkflowRunStatusSchema.optional(),
})

export async function POST(request: Request) {
  let idempotencyKey: string | undefined
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const rateLimited = applyRateLimit(request, { bucket: 'runs', limit: 30, windowMs: 5 * 60 * 1000 })
    if (rateLimited) return rateLimited
    const initialContext = resolveRuntimeContext(request, session)
    idempotencyKey = initialContext.idempotencyKey
    const body = StartSchema.parse(await request.json())
    const context = { ...initialContext, policyConfirmed: body.policy_confirmed === true }
    const service = await getApiRuntimeService(getBasePath())
    const run = await service.startRun({
      sequence_id: body.sequence_id, target: body.target,
      strategy: body.strategy, max_concurrency: body.max_concurrency,
    }, context)
    return runtimeJson(await service.inspectRun(run.id), 202, idempotencyKey, `/api/runs/${run.id}`)
  } catch (error) {
    return handleRuntimeError(error, idempotencyKey)
  }
}

export async function GET(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const rateLimited = applyRateLimit(request, { bucket: 'runs-read', limit: 120, windowMs: 5 * 60 * 1000 })
    if (rateLimited) return rateLimited
    const url = new URL(request.url)
    const allowed = new Set(['sequence_id', 'status'])
    for (const key of url.searchParams.keys()) {
      if (!allowed.has(key)) return runtimeJson({ error: `Unsupported query parameter: ${key}`, code: 'VALIDATION_ERROR' }, 400)
    }
    const query = ListSchema.parse(Object.fromEntries(url.searchParams.entries()))
    const service = await getApiRuntimeService(getBasePath())
    return runtimeJson({ runs: await service.listRuns({ sequenceId: query.sequence_id, status: query.status }) }, 200)
  } catch (error) {
    return handleRuntimeError(error)
  }
}

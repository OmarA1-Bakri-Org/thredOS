import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRequestSession } from '@/lib/api-helpers'
import { getApiRuntimeService, handleRuntimeError, resolveRuntimeContext, runtimeJson } from '@/lib/api/runtime-request'
import { getBasePath } from '@/lib/config'
import { applyRateLimit } from '@/lib/rate-limit'

const Params = z.object({ changeSetId: z.string().min(1) })
const BoundBody = z.object({
  run_id: z.string().min(1), attempt_id: z.string().min(1),
  expected_revision: z.number().int().nonnegative(),
}).strict()
const Body = z.union([BoundBody, z.object({ expected_revision: z.number().int().nonnegative() }).strict()])

export async function POST(request: Request, { params }: { params: Promise<{ changeSetId: string }> }) {
  let idempotencyKey: string | undefined
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const limited = applyRateLimit(request, { bucket: 'change-set-select', limit: 30, windowMs: 5 * 60 * 1000 })
    if (limited) return limited
    const context = resolveRuntimeContext(request, session)
    idempotencyKey = context.idempotencyKey
    const { changeSetId } = Params.parse(await params)
    const body = Body.parse(await request.json())
    const service = await getApiRuntimeService(getBasePath())
    const changeSet = 'run_id' in body
      ? await service.selectChangeSet({ runId: body.run_id, attemptId: body.attempt_id,
        changeSetId, expectedRevision: body.expected_revision }, context)
      : await service.selectChangeSetById({ changeSetId, expectedRevision: body.expected_revision }, context)
    return runtimeJson({ schema_version: 1, change_set: changeSet }, 200, idempotencyKey)
  } catch (error) { return handleRuntimeError(error, idempotencyKey) }
}

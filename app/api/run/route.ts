import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auditLog, requireRequestSession } from '@/lib/api-helpers'
import { getApiRuntimeService, handleRuntimeError, resolveRuntimeContext, runtimeJson } from '@/lib/api/runtime-request'
import { getBasePath } from '@/lib/config'
import { applyRateLimit } from '@/lib/rate-limit'
import { RuntimeErrorCodeSchema } from '@/lib/runtime/error-codes'
import { RuntimeServiceError } from '@/lib/runtime/errors'

const BodySchema = z.union([
  z.object({ stepId: z.string().min(1) }),
  z.object({ mode: z.literal('runnable') }),
  z.object({ groupId: z.string().min(1) }),
]).and(z.object({ confirmPolicy: z.boolean().optional() }))

function legacyResult(result: Awaited<ReturnType<import('@/lib/runtime/service').ThreadOSRuntimeService['runAndWait']>>) {
  const executed = result.attempts.map(attempt => ({
    success: attempt.status === 'completed', stepId: attempt.step_id, runId: result.run.id,
    status: attempt.error_code === 'PRE_RUN_GATE_BLOCKED' ? 'READY'
      : attempt.status === 'completed' ? 'DONE'
      : attempt.status === 'needs_review' ? 'NEEDS_REVIEW'
        : attempt.status === 'running' ? 'RUNNING' : 'FAILED',
    duration: attempt.duration_ms ?? undefined,
    artifactPath: attempt.artifact_manifest_ref ?? undefined,
    error: attempt.error_message ?? undefined,
    gateReasons: attempt.error_code === 'PRE_RUN_GATE_BLOCKED'
      ? (attempt.error_message?.split(',').map(reason => reason.trim()).filter(Boolean) ?? [])
      : attempt.status === 'completed' ? [] : undefined,
  }))
  return { success: result.run.status === 'successful', executed }
}

function throwLegacyTypedFailure(
  result: Awaited<ReturnType<import('@/lib/runtime/service').ThreadOSRuntimeService['runAndWait']>>,
): void {
  const attemptCode = result.attempts.find(attempt =>
    attempt.error_code === 'POLICY_DENIED' || attempt.error_code === 'POLICY_CONFIRMATION_REQUIRED')?.error_code
  const candidate = attemptCode ?? (result.attempts.length === 0 && result.run.status === 'failed' ? result.run.error_code : null)
  const parsed = RuntimeErrorCodeSchema.safeParse(candidate)
  if (parsed.success) {
    throw new RuntimeServiceError(parsed.data, result.attempts[0]?.error_message ?? result.run.error_message ?? 'Runtime request failed')
  }
}

export async function POST(request: Request) {
  let idempotencyKey: string | undefined
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const rateLimited = applyRateLimit(request, { bucket: 'run', limit: 30, windowMs: 5 * 60 * 1000 })
    if (rateLimited) return rateLimited
    const initialContext = resolveRuntimeContext(request, session)
    idempotencyKey = initialContext.idempotencyKey
    const body = BodySchema.parse(await request.json())
    const context = { ...initialContext, policyConfirmed: body.confirmPolicy === true }
    const service = await getApiRuntimeService(getBasePath())
    const target = 'stepId' in body ? { kind: 'step' as const, step_id: body.stepId }
      : 'groupId' in body ? { kind: 'group' as const, group_id: body.groupId }
        : { kind: 'runnable' as const }
    const completed = await service.runAndWait({
      sequence_id: '$current', target, strategy: 'sequential', max_concurrency: 1,
      allow_empty: !('stepId' in body),
    }, context)
    throwLegacyTypedFailure(completed)
    const legacy = legacyResult(completed)
    await auditLog('run', 'stepId' in body ? body.stepId : 'groupId' in body ? body.groupId : '*', { runId: completed.run.id }, legacy.success ? 'ok' : 'failed')
    if ('stepId' in body) return runtimeJson(legacy.executed[0] ?? { success: true, executed: [] }, 200, idempotencyKey)
    return runtimeJson(legacy, 200, idempotencyKey)
  } catch (error) {
    return handleRuntimeError(error, idempotencyKey)
  }
}

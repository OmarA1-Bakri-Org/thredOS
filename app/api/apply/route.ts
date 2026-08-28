import { randomUUID } from 'crypto'
import { z } from 'zod'
import { ActionValidator, type ProposedAction } from '@/lib/chat/validator'
import { getBasePath } from '@/lib/config'
import { jsonError, requireRequestSession } from '@/lib/api-helpers'
import { allowChatApply } from '@/lib/hosted'
import { applyRateLimit } from '@/lib/rate-limit'

const ApplyBodySchema = z.object({
  actions: z.array(z.object({
    command: z.string(),
    args: z.record(z.string(), z.union([z.string(), z.array(z.string()), z.boolean(), z.number()]).optional()),
  })).min(1),
  runId: z.string().min(1).optional(),
})

export async function POST(request: Request) {
  try {
    const sessionResult = requireRequestSession(request)
    if ('status' in sessionResult) return sessionResult

    const rateLimited = applyRateLimit(request, {
      bucket: 'chat-apply',
      limit: 10,
      windowMs: 60 * 1000,
    })
    if (rateLimited) return rateLimited

    if (!allowChatApply()) {
      return jsonError(
        'Chat apply is disabled in hosted mode until it shares the invariant-enforcing control plane',
        'CHAT_APPLY_DISABLED',
        403,
      )
    }

    const parsed = ApplyBodySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return Response.json(
        { success: false, errors: parsed.error.issues.map(issue => issue.message) },
        { status: 400 },
      )
    }

    const { actions } = parsed.data as { actions: ProposedAction[] }
    const runId = parsed.data.runId ?? `chat-apply-${randomUUID()}`

    // Cap the number of actions to prevent abuse
    if (actions.length > 50) {
      return Response.json({ success: false, errors: ['Too many actions (max 50)'] }, { status: 400 })
    }

    const basePath = getBasePath()
    const validator = new ActionValidator(basePath)
    const result = await validator.apply(actions)

    return Response.json({ ...result, runId })
  } catch {
    return Response.json(
      { success: false, errors: ['Internal server error'] },
      { status: 500 }
    )
  }
}

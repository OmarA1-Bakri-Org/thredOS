import { NextRequest } from 'next/server'
import { ActionValidator, type ProposedAction } from '@/lib/chat/validator'
import { getBasePath } from '@/lib/config'
import { jsonError } from '@/lib/api-helpers'
import { allowChatApply } from '@/lib/hosted'
import { applyRateLimit } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  try {
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

    const body = await request.json()
    const { actions } = body as { actions: ProposedAction[] }

    if (!actions || !Array.isArray(actions) || actions.length === 0) {
      return Response.json({ success: false, errors: ['No actions provided'] }, { status: 400 })
    }

    // Cap the number of actions to prevent abuse
    if (actions.length > 50) {
      return Response.json({ success: false, errors: ['Too many actions (max 50)'] }, { status: 400 })
    }

    const validator = new ActionValidator(getBasePath())
    const result = await validator.apply(actions)
    return Response.json(result)
  } catch {
    return Response.json(
      { success: false, errors: ['Internal server error'] },
      { status: 500 }
    )
  }
}

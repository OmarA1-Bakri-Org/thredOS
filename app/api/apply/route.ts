import { NextRequest } from 'next/server'
import { ActionValidator, type ProposedAction } from '@/lib/chat/validator'
import { getBasePath } from '@/lib/config'

export async function POST(request: NextRequest) {
  try {
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

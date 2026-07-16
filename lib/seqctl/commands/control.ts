import { RuntimeServiceError } from '../../runtime/errors'
import type { StepAttemptStatus } from '../../runtime/schema'
import { renderRuntimeFailure, renderRuntimeSuccess, type CLIOptions } from '../formatters/runtime'
import { createCLIContext, getCLIRuntimeService } from '../runtime'

const TERMINAL_ATTEMPTS: StepAttemptStatus[] = [
  'completed', 'needs_review', 'failed', 'cancelled', 'timed_out', 'interrupted',
]

function requireStepId(args: string[], action: string): string {
  const stepId = args[0]?.trim()
  if (!stepId) throw new RuntimeServiceError('VALIDATION_ERROR', `Usage: thread ${action} <stepId>`)
  return stepId
}

export async function controlCommand(
  subcommand: string | undefined,
  args: string[],
  options: CLIOptions,
): Promise<void> {
  try {
    const action = subcommand ?? 'control'
    const stepId = requireStepId(args, action)
    const service = await getCLIRuntimeService(options.basePath ?? process.cwd())
    const context = createCLIContext(options)

    if (subcommand === 'stop') {
      const attempt = await service.findLatestAttempt({
        sequenceId: '$current', stepId, statuses: ['running'],
      })
      if (!attempt) throw new RuntimeServiceError('ATTEMPT_NOT_RUNNING', `step ${stepId} has no running attempt`)
      const cancelled = await service.cancelAttempt(attempt.id, context)
      renderRuntimeSuccess({ attempt: cancelled }, options, () => console.log(`Step '${stepId}' stopped`))
      return
    }

    if (subcommand === 'restart') {
      const attempt = await service.findLatestAttempt({
        sequenceId: '$current', stepId, statuses: TERMINAL_ATTEMPTS,
      })
      if (!attempt) throw new RuntimeServiceError('ATTEMPT_NOT_FOUND', `step ${stepId} has no terminal attempt to retry`)
      const retried = await service.retryAttempt(attempt.id, context)
      const projection = await service.inspectAttempt(retried.id)
      renderRuntimeSuccess(projection, options, () => console.log(`Step '${stepId}' restarted as attempt '${retried.id}'`))
      return
    }

    throw new RuntimeServiceError('VALIDATION_ERROR', 'Unknown subcommand. Usage: thread stop|restart <stepId>')
  } catch (error) {
    renderRuntimeFailure(error, options)
  }
}

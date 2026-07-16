import { RuntimeServiceError } from '../../runtime/errors'
import { renderRuntimeFailure, renderRuntimeSuccess, type CLIOptions } from '../formatters/runtime'
import { createCLIContext, getCLIRuntimeService } from '../runtime'

function requireAttemptId(args: string[], action: string): string {
  const attemptId = args[0]?.trim()
  if (!attemptId) throw new RuntimeServiceError('VALIDATION_ERROR', `Usage: thread attempt ${action} <attemptId>`)
  return attemptId
}

export async function attemptCommand(
  subcommand: string | undefined,
  args: string[],
  options: CLIOptions,
): Promise<void> {
  try {
    const action = subcommand ?? 'inspect'
    const attemptId = requireAttemptId(args, action)
    const service = await getCLIRuntimeService(options.basePath ?? process.cwd())

    if (subcommand === 'inspect') {
      const projection = await service.inspectAttempt(attemptId)
      renderRuntimeSuccess(projection, options, () => {
        console.log(`${projection.attempt.id}: ${projection.attempt.status} (step ${projection.attempt.step_id})`)
      })
      return
    }
    if (subcommand === 'cancel') {
      const attempt = await service.cancelAttempt(attemptId, createCLIContext(options))
      const projection = await service.inspectAttempt(attempt.id)
      renderRuntimeSuccess(projection, options, () => console.log(`Attempt '${attempt.id}' cancelled`))
      return
    }
    if (subcommand === 'retry') {
      const attempt = await service.retryAttempt(attemptId, createCLIContext(options))
      const projection = await service.inspectAttempt(attempt.id)
      renderRuntimeSuccess(projection, options, () => console.log(`Attempt '${attemptId}' retried as '${attempt.id}'`))
      return
    }
    throw new RuntimeServiceError('VALIDATION_ERROR', 'Unknown subcommand. Usage: thread attempt inspect|cancel|retry <attemptId>')
  } catch (error) {
    renderRuntimeFailure(error, options)
  }
}

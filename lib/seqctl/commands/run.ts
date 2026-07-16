import { RuntimeServiceError } from '../../runtime/errors'
import type { CompletedRunResult, RunProjection } from '../../runtime/service-types'
import type { WorkflowRunTarget } from '../../runtime/schema'
import { CLI_EXIT_CODE, renderRuntimeFailure, renderRuntimeSuccess, type CLIOptions } from '../formatters/runtime'
import { createCLIContext, getCLIRuntimeService } from '../runtime'

function required(args: string[], index: number, usage: string): string {
  const value = args[index]?.trim()
  if (!value) throw new RuntimeServiceError('VALIDATION_ERROR', usage)
  return value
}

function printCompleted(result: CompletedRunResult, target: WorkflowRunTarget): void {
  if (target.kind === 'step') {
    const attempt = result.attempts.find(candidate => candidate.step_id === target.step_id)
    if (result.run.status === 'successful' && attempt) {
      console.log(`Step '${target.step_id}' completed successfully`)
      if (attempt.duration_ms != null) console.log(`Duration: ${attempt.duration_ms}ms`)
      if (attempt.artifact_manifest_ref) console.log(`Artifacts: ${attempt.artifact_manifest_ref}`)
      return
    }
    console.error(`Step '${target.step_id}' finished with status ${attempt?.status ?? result.run.status}`)
    return
  }
  const label = target.kind === 'group' ? ` from group '${target.group_id}'` : ''
  console.log(`Executed ${result.attempts.length} step(s)${label}`)
  for (const attempt of result.attempts) {
    console.log(`  ${attempt.step_id}: ${attempt.status.toUpperCase()}${attempt.duration_ms == null ? '' : ` (${attempt.duration_ms}ms)`}`)
  }
}

function printRunProjection(projection: RunProjection): void {
  console.log(`${projection.run.id}: ${projection.run.status} (${projection.attempts.length} attempt(s))`)
}

async function executeTarget(target: WorkflowRunTarget, options: CLIOptions): Promise<void> {
  const basePath = options.basePath ?? process.cwd()
  const service = await getCLIRuntimeService(basePath)
  const result = await service.runAndWait({
    sequence_id: '$current',
    target,
    strategy: 'sequential',
    max_concurrency: 1,
    allow_empty: target.kind === 'runnable' || target.kind === 'group',
  }, createCLIContext(options))
  if (result.run.status !== 'successful') {
    const failedAttempt = result.attempts.find(attempt => attempt.error_code)
    const typedCode = failedAttempt?.error_code ?? result.run.error_code
    if (typedCode) {
      renderRuntimeFailure({
        code: typedCode,
        message: failedAttempt?.error_message ?? result.run.error_message ?? `Run '${result.run.id}' failed`,
      }, options)
      return
    }
    renderRuntimeFailure({
      code: `RUN_${result.run.status.toUpperCase()}`,
      message: `Run '${result.run.id}' finished with status ${result.run.status}`,
    }, options)
    process.exitCode = CLI_EXIT_CODE.runtimeOutcome
    return
  }
  renderRuntimeSuccess(result, options, () => printCompleted(result, target))
}

export async function runCommand(
  subcommand: string | undefined,
  args: string[],
  options: CLIOptions,
): Promise<void> {
  try {
    const basePath = options.basePath ?? process.cwd()
    const service = await getCLIRuntimeService(basePath)
    switch (subcommand) {
      case 'step':
        await executeTarget({ kind: 'step', step_id: required(args, 0, 'Step ID required: thread run step <stepId>') }, options)
        return
      case 'runnable':
        await executeTarget({ kind: 'runnable' }, options)
        return
      case 'group':
        await executeTarget({ kind: 'group', group_id: required(args, 0, 'Group ID required: thread run group <groupId>') }, options)
        return
      case 'list': {
        const runs = await service.listRuns()
        renderRuntimeSuccess({ runs }, options, () => {
          if (runs.length === 0) console.log('No runtime runs found')
          else runs.forEach(printRunProjection)
        })
        return
      }
      case 'inspect': {
        const runId = required(args, 0, 'Usage: thread run inspect <runId>')
        const projection = await service.inspectRun(runId)
        renderRuntimeSuccess(projection, options, () => printRunProjection(projection))
        return
      }
      case 'cancel': {
        const runId = required(args, 0, 'Usage: thread run cancel <runId>')
        const run = await service.cancelRun(runId, createCLIContext(options))
        const projection = await service.inspectRun(run.id)
        renderRuntimeSuccess(projection, options, () => console.log(`Run '${run.id}' cancelled`))
        return
      }
      default:
        throw new RuntimeServiceError(
          'VALIDATION_ERROR',
          'Unknown subcommand. Usage: thread run step|runnable|group|list|inspect|cancel',
        )
    }
  } catch (error) {
    renderRuntimeFailure(error, options)
  }
}

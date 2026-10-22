import { RuntimeServiceError } from '../../runtime/errors'
import { renderRuntimeFailure, renderRuntimeSuccess, type CLIOptions } from '../formatters/runtime'
import { createCLIContext, getCLIRuntimeService } from '../runtime'

export async function mergeCommand(subcommand: string | undefined, args: string[], options: CLIOptions): Promise<void> {
  try {
    if (args.length !== (['apply', 'rollback'].includes(subcommand ?? '') ? 3 : 1) || !args[0]?.trim()) {
      throw new RuntimeServiceError('VALIDATION_ERROR', 'Usage: thread merge preview|inspect|validate|approval-subject|rollback-subject|result|recover|recover-validation <id>; apply|rollback <id> <approvalId> <digest>')
    }
    const service = await getCLIRuntimeService(options.basePath ?? process.cwd())
    switch (subcommand) {
      case 'preview': {
        const result = await service.previewSelectedChangeSet(args[0], createCLIContext(options))
        renderRuntimeSuccess({ schema_version: 1, ...result }, options,
          () => console.log(`${result.plan.id}: ${result.plan.status} (${result.preview_id})`))
        return
      }
      case 'inspect': {
        const plan = await service.inspectMergePlan(args[0])
        if (!plan) throw new RuntimeServiceError('MERGE_PLAN_NOT_FOUND', 'Merge plan was not found')
        renderRuntimeSuccess({ schema_version: 1, plan }, options,
          () => console.log(`${plan.id}: ${plan.status} (revision ${plan.revision})`))
        return
      }
      case 'approval-subject':
      case 'rollback-subject': {
        const subject = subcommand === 'approval-subject'
          ? await service.inspectMergeApprovalSubject(args[0], createCLIContext(options))
          : await service.inspectMergeRollbackSubject(args[0], createCLIContext(options))
        renderRuntimeSuccess({ schema_version: 1, subject }, options, () => console.log(JSON.stringify(subject)))
        return
      }
      case 'apply':
      case 'rollback': {
        const input = { approval_id: args[1]!, plan_digest: args[2]! }
        const result = subcommand === 'apply'
          ? await service.applyMergePlan(args[0], input, createCLIContext(options))
          : await service.rollbackMergeResult(args[0], input, createCLIContext(options))
        const completed = result.filesystem_apply.status === (subcommand === 'apply' ? 'applied' : 'rolled_back')
        renderRuntimeSuccess({ schema_version: 1, result }, options,
          () => console.log(`${result.id}: ${result.filesystem_apply.status}`), completed ? 0 : 6)
        return
      }
      case 'result': {
        const result = await service.inspectMergeResult(args[0])
        if (!result) throw new RuntimeServiceError('MERGE_RESULT_NOT_FOUND', 'Merge result was not found')
        renderRuntimeSuccess({ schema_version: 1, result }, options, () => console.log(`${result.id}: ${result.filesystem_apply.status}`))
        return
      }
      case 'recover': {
        const report = await service.recoverMergeResult(args[0], createCLIContext(options))
        renderRuntimeSuccess(report, options, () => console.log(`${report.result.id}: ${report.disposition}`),
          report.disposition === 'requires_review' ? 6 : 0)
        return
      }
      case 'recover-validation': {
        const report = await service.recoverMergeValidation(args[0], createCLIContext(options))
        renderRuntimeSuccess(report, options, () => console.log(`${report.plan_id}: ${report.disposition}`),
          report.disposition === 'requires_review' ? 6 : 0)
        return
      }
      case 'validate': {
        const plan = await service.validateMergePlan(args[0], createCLIContext(options))
        renderRuntimeSuccess({ schema_version: 1, plan }, options,
          () => console.log(`${plan.id}: ${plan.status} (revision ${plan.revision})`))
        return
      }
      default:
        throw new RuntimeServiceError('VALIDATION_ERROR', 'Usage: thread merge preview|inspect|validate|approval-subject|rollback-subject|result|recover|recover-validation <id>; apply|rollback <id> <approvalId> <digest>')
    }
  } catch (error) { renderRuntimeFailure(error, options) }
}

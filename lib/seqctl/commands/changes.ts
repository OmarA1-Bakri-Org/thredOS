import { RuntimeServiceError } from '../../runtime/errors'
import type { ChangeSetReview, ChangeSetSummary } from '../../changesets/diff'
import { renderRuntimeFailure, renderRuntimeSuccess, type CLIOptions } from '../formatters/runtime'
import { createCLIContext, getCLIRuntimeService } from '../runtime'

function requireArgs(args: string[], count: number, usage: string): string[] {
  if (args.length !== count || args.some(value => !value.trim())) {
    throw new RuntimeServiceError('VALIDATION_ERROR', `Usage: thread changes ${usage}`)
  }
  return args
}

function revision(value: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0 || String(parsed) !== value) {
    throw new RuntimeServiceError('VALIDATION_ERROR', 'Expected revision must be a nonnegative integer')
  }
  return parsed
}

function listRunId(args: string[]): string {
  if (args.length === 1 && args[0]?.trim() && !args[0].startsWith('--')) return args[0]
  if (args.length === 2 && args[0] === '--run' && args[1]?.trim()) return args[1]
  if (args.length === 1 && args[0]?.startsWith('--run=') && args[0].slice(6).trim()) return args[0].slice(6)
  throw new RuntimeServiceError('VALIDATION_ERROR', 'Usage: thread changes list --run <runId>')
}

function decisionContext(options: CLIOptions, action: 'select' | 'reject', target: string) {
  return createCLIContext({ ...options,
    idempotencyKey: options.idempotencyKey ?? `changes-${action}-${target}`,
  })
}

function printSummary(summary: ChangeSetSummary): void {
  console.log(`${summary.id}: ${summary.status} (revision ${summary.revision})`)
  console.log(`  Run ${summary.workflow_run_id} / attempt ${summary.attempt_id}`)
  console.log(`  ${summary.entry_count} changed paths, ${summary.total_bytes} bytes`)
  if (summary.path_scope_violations.length) {
    console.log(`  Scope violations: ${summary.path_scope_violations.join(', ')}`)
  }
}

function safeTerminal(value: string): string {
  return value.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '�')
}

function printReview(review: ChangeSetReview): void {
  printSummary(review.summary)
  console.log(`  Baseline: ${review.summary.baseline_snapshot_id}`)
  console.log(`  Validation: ${review.summary.validation.status}`)
  console.log(`  Output contract: ${review.summary.output_contract_state}`)
  for (const entry of review.entries) {
    console.log(`  ${entry.operation} ${entry.path} (${entry.content_kind})`)
    if (entry.unified_diff) console.log(safeTerminal(entry.unified_diff))
    else if (entry.content_kind === 'binary') console.log(
      `    ${entry.before_sha256 ?? 'none'} (${entry.size_bytes_before} bytes) -> `
      + `${entry.after_sha256 ?? 'none'} (${entry.size_bytes_after} bytes)`,
    )
    if (entry.preview_truncated) console.log('    Preview truncated')
  }
  if (review.file_tree_truncated) console.log('  File tree truncated')
  if (review.test_evidence_refs.length) console.log(`  Test evidence: ${review.test_evidence_refs.join(', ')}`)
}

function printShow(review: ChangeSetReview): void {
  printSummary(review.summary)
  console.log(`  Baseline: ${review.summary.baseline_snapshot_id}`)
  console.log(`  Validation: ${review.summary.validation.status}`)
  console.log(`  Output contract: ${review.summary.output_contract_state}`)
  for (const entry of review.entries) console.log(`  ${entry.operation} ${entry.path} (${entry.content_kind})`)
  if (review.file_tree_truncated) console.log('  File tree truncated')
}

export async function changesCommand(subcommand: string | undefined, args: string[], options: CLIOptions): Promise<void> {
  try {
    const service = await getCLIRuntimeService(options.basePath ?? process.cwd())
    switch (subcommand) {
      case 'list': {
        const changeSets = await service.listChangeSets(listRunId(args))
        renderRuntimeSuccess({ schema_version: 1, change_sets: changeSets }, options, () => {
          if (!changeSets.length) console.log('No Change Sets found')
          else changeSets.forEach(printSummary)
        })
        return
      }
      case 'show':
      case 'diff': {
        const [id] = requireArgs(args, 1, `${subcommand} <changeSetId>`)
        const review = await service.inspectChangeSetById(id!)
        renderRuntimeSuccess(review, options, () => subcommand === 'show' ? printShow(review) : printReview(review))
        return
      }
      case 'inspect': {
        const [runId, attemptId] = requireArgs(args, 2, 'inspect <runId> <attemptId>')
        const review = await service.inspectChangeSet(runId!, attemptId!)
        renderRuntimeSuccess(review, options, () => printReview(review))
        return
      }
      case 'compare': {
        const [runId, left, right] = requireArgs(args, 3, 'compare <runId> <leftAttemptId> <rightAttemptId>')
        const comparison = await service.compareChangeSets(runId!, left!, right!)
        renderRuntimeSuccess(comparison, options, () => {
          console.log(`${comparison.left.id} vs ${comparison.right.id}`)
          for (const path of comparison.paths) console.log(`  ${path.relation}: ${path.path}`)
          if (comparison.truncated) console.log('  Comparison truncated')
        })
        return
      }
      case 'select': {
        const oldAlias = args.length === 3 && args[1] !== '--expected-revision'
        const context = decisionContext(options, 'select', oldAlias ? `${args[0]}-${args[1]}` : args[0] ?? '')
        let selected: ChangeSetSummary
        if (args.length === 1 && args[0]?.trim()) {
          selected = await service.selectChangeSetById({ changeSetId: args[0] }, context)
        } else if (args.length === 3 && args[1] === '--expected-revision' && args[0]?.trim()) {
          selected = await service.selectChangeSetById({ changeSetId: args[0],
            expectedRevision: revision(args[2]!) }, context)
        } else {
          const [runId, attemptId, expected] = requireArgs(args, 3, 'select <changeSetId> [--expected-revision <n>]')
          selected = await service.selectChangeSet({ runId: runId!, attemptId: attemptId!,
            expectedRevision: revision(expected!) }, context)
        }
        renderRuntimeSuccess({ schema_version: 1, change_set: selected }, options, () => printSummary(selected))
        return
      }
      case 'reject': {
        const oldAlias = args.length >= 4 && !args[0]?.startsWith('change-set-') && /^\d+$/.test(args[2] ?? '')
        const context = decisionContext(options, 'reject', oldAlias ? `${args[0]}-${args[1]}` : args[0] ?? '')
        let rejected: ChangeSetSummary
        if (oldAlias) {
          const [runId, attemptId, expected, ...reasonParts] = args
          rejected = await service.rejectChangeSet({ runId: runId!, attemptId: attemptId!,
            expectedRevision: revision(expected!), reason: reasonParts.join(' ') }, context)
        } else {
          if (!args[0]?.trim()) throw new RuntimeServiceError('VALIDATION_ERROR',
            'Usage: thread changes reject <changeSetId> [reason]')
          const hasRevision = args[1] === '--expected-revision'
          if (hasRevision && !args[2]) throw new RuntimeServiceError('VALIDATION_ERROR', 'Expected revision is required')
          const reason = args.slice(hasRevision ? 3 : 1).join(' ').trim() || 'Rejected by operator'
          rejected = await service.rejectChangeSetById({ changeSetId: args[0],
            ...(hasRevision ? { expectedRevision: revision(args[2]!) } : {}), reason }, context)
        }
        renderRuntimeSuccess({ schema_version: 1, change_set: rejected }, options, () => printSummary(rejected))
        return
      }
      default:
        throw new RuntimeServiceError('VALIDATION_ERROR',
          'Unknown subcommand. Usage: thread changes list|show|diff|compare|select|reject')
    }
  } catch (error) { renderRuntimeFailure(error, options) }
}

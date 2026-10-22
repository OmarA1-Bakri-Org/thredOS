import { ZodError } from 'zod'
import { RuntimeServiceError } from '../../runtime/errors'
import { RuntimeRepositoryError } from '../../runtime/run-repository'
import type { WorkflowRunStatus } from '../../runtime/schema'
import { runtimeFailure, runtimeSuccess } from '../runtime-json-schema'

export interface CLIOptions {
  json: boolean
  help: boolean
  watch: boolean
  basePath?: string
  idempotencyKey?: string
  policyConfirmed?: boolean
}

export const CLI_EXIT_CODE = {
  success: 0,
  error: 1,
  validation: 2,
  policy: 3,
  notFound: 4,
  conflict: 5,
  runtimeOutcome: 6,
  processControl: 7,
  unavailable: 8,
} as const

const ERROR_EXIT_CODE: Record<string, number> = {
  VALIDATION_ERROR: CLI_EXIT_CODE.validation,
  POLICY_DENIED: CLI_EXIT_CODE.policy,
  POLICY_CONFIRMATION_REQUIRED: CLI_EXIT_CODE.policy,
  RUN_NOT_FOUND: CLI_EXIT_CODE.notFound,
  RUNTIME_TARGET_NOT_FOUND: CLI_EXIT_CODE.notFound,
  ATTEMPT_NOT_FOUND: CLI_EXIT_CODE.notFound,
  IDEMPOTENCY_CONFLICT: CLI_EXIT_CODE.conflict,
  ATTEMPT_NOT_RUNNING: CLI_EXIT_CODE.conflict,
  INVALID_RUNTIME_TRANSITION: CLI_EXIT_CODE.conflict,
  RUNTIME_REVISION_CONFLICT: CLI_EXIT_CODE.conflict,
  MERGE_CONFLICT: CLI_EXIT_CODE.conflict,
  MERGE_PRECONDITION_FAILED: CLI_EXIT_CODE.conflict,
  MERGE_SELECTION_STALE: CLI_EXIT_CODE.conflict,
  MERGE_CHANGE_SET_NOT_FOUND: CLI_EXIT_CODE.notFound,
  MERGE_BASELINE_UNAVAILABLE: CLI_EXIT_CODE.unavailable,
  MERGE_PLAN_PRECONDITION_FAILED: CLI_EXIT_CODE.conflict,
  MERGE_SOURCE_PATH_CHANGED: CLI_EXIT_CODE.conflict,
  MERGE_UNSAFE_PREVIEW_STORAGE: CLI_EXIT_CODE.conflict,
  MERGE_CANDIDATE_CONTENT_UNAVAILABLE: CLI_EXIT_CODE.unavailable,
  MERGE_PREVIEW_QUOTA_EXCEEDED: CLI_EXIT_CODE.unavailable,
  MERGE_PLAN_NOT_READY: CLI_EXIT_CODE.conflict,
  MERGE_PLAN_NOT_FOUND: CLI_EXIT_CODE.notFound,
  MERGE_PREVIEW_NOT_READY: CLI_EXIT_CODE.conflict,
  MERGE_STALE_CANONICAL: CLI_EXIT_CODE.conflict,
  MERGE_PREVIEW_CHANGED: CLI_EXIT_CODE.conflict,
  MERGE_CONFLICTS_UNRESOLVED: CLI_EXIT_CODE.conflict,
  MERGE_IDEMPOTENCY_CONFLICT: CLI_EXIT_CODE.conflict,
  MERGE_VALIDATION_FAILED: CLI_EXIT_CODE.runtimeOutcome,
  MERGE_VALIDATION_EVIDENCE_MISSING: CLI_EXIT_CODE.conflict,
  MERGE_VALIDATION_RECOVERY_REQUIRED: CLI_EXIT_CODE.conflict,
  MERGE_VALIDATION_CONFIG_CHANGED: CLI_EXIT_CODE.conflict,
  MERGE_VALIDATION_POLICY_DENIED: CLI_EXIT_CODE.policy,
  MERGE_APPLY_CAPABILITY_UNAVAILABLE: CLI_EXIT_CODE.unavailable,
  MERGE_EVIDENCE_UNAVAILABLE: CLI_EXIT_CODE.unavailable,
  SNAPSHOT_SOURCE_CHANGED: CLI_EXIT_CODE.conflict,
  SNAPSHOT_SOURCE_BUSY: CLI_EXIT_CODE.conflict,
  WORKSPACE_NOT_CLEANABLE: CLI_EXIT_CODE.conflict,
  PROCESS_CONTROL_FAILED: CLI_EXIT_CODE.processControl,
  PROCESS_CONTROL_DISABLED: CLI_EXIT_CODE.processControl,
  PROCESS_LOST: CLI_EXIT_CODE.processControl,
  AGENT_UNAVAILABLE: CLI_EXIT_CODE.unavailable,
  PARALLEL_RUNTIME_UNAVAILABLE: CLI_EXIT_CODE.unavailable,
  WORKSPACE_PROVISION_FAILED: CLI_EXIT_CODE.unavailable,
  WORKSPACE_QUOTA_EXCEEDED: CLI_EXIT_CODE.unavailable,
  SNAPSHOT_REQUIRED: CLI_EXIT_CODE.unavailable,
  WORKSPACE_REQUIRED: CLI_EXIT_CODE.unavailable,
  WORKSPACE_MANIFEST_INVALID: CLI_EXIT_CODE.unavailable,
  WORKSPACE_BOOTSTRAP_FAILED: CLI_EXIT_CODE.unavailable,
  CANONICAL_WORKSPACE_MUTATED: CLI_EXIT_CODE.conflict,
  WORKSPACE_NOT_FOUND: CLI_EXIT_CODE.notFound,
  CHANGE_SET_NOT_FOUND: CLI_EXIT_CODE.notFound,
  CHANGE_SET_REVISION_CONFLICT: CLI_EXIT_CODE.conflict,
  CHANGE_SET_INVALID_TRANSITION: CLI_EXIT_CODE.conflict,
  CHANGE_SET_IDENTITY_MISMATCH: CLI_EXIT_CODE.conflict,
  CHANGE_SET_BASELINE_MISMATCH: CLI_EXIT_CODE.conflict,
  CHANGE_SET_NOT_READY: CLI_EXIT_CODE.conflict,
  CHANGE_SET_NOT_REVEALED: CLI_EXIT_CODE.policy,
  CHANGE_SET_SCHEMA_UPGRADE_REQUIRED: CLI_EXIT_CODE.conflict,
}

interface CodedError {
  code?: unknown
  message?: unknown
}

export function normalizeRuntimeError(error: unknown): { code: string; message: string } {
  if (error instanceof ZodError) {
    return {
      code: 'VALIDATION_ERROR',
      message: error.issues.map(issue => issue.message).join(', '),
    }
  }
  if (error instanceof RuntimeServiceError || error instanceof RuntimeRepositoryError) {
    return { code: error.code, message: error.message }
  }
  if (error && typeof error === 'object') {
    const coded = error as CodedError
    if (typeof coded.code === 'string' && typeof coded.message === 'string') {
      return { code: coded.code, message: coded.message }
    }
  }
  return {
    code: 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : String(error),
  }
}

export function runtimeOutcomeExitCode(status: WorkflowRunStatus): number {
  return status === 'successful' ? CLI_EXIT_CODE.success : CLI_EXIT_CODE.runtimeOutcome
}

export function renderRuntimeSuccess(
  data: unknown,
  options: CLIOptions,
  human: () => void,
  exitCode = CLI_EXIT_CODE.success,
): void {
  process.exitCode = exitCode
  if (options.json) {
    console.log(JSON.stringify(runtimeSuccess(data)))
  } else {
    human()
  }
}

export function renderRuntimeFailure(error: unknown, options: CLIOptions): void {
  const normalized = normalizeRuntimeError(error)
  process.exitCode = ERROR_EXIT_CODE[normalized.code] ?? CLI_EXIT_CODE.error
  if (options.json) {
    console.log(JSON.stringify(runtimeFailure(normalized.code, normalized.message)))
  } else {
    console.error(`Error [${normalized.code}]: ${normalized.message}`)
  }
}

import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import type { AuthSession } from '../auth/session'
import { getThreadOSRuntimeService, type RuntimeFactoryOptions } from '../runtime/factory'
import { RuntimeServiceError } from '../runtime/errors'
import type { ThreadOSRuntimeService } from '../runtime/service'
import { RuntimeRepositoryError } from '../runtime/run-repository'
import type { RuntimeCommandContext } from '../runtime/service-types'
import type { RuntimeServiceDependencies } from '../runtime/service-types'
import { allowHostedProcessControls } from '../hosted'

export type RuntimeServicePort = Pick<ThreadOSRuntimeService,
  'startRun' | 'runAndWait' | 'listRuns' | 'inspectRun' | 'inspectAttempt' |
  'cancelRun' | 'cancelAttempt' | 'retryAttempt' | 'findLatestAttempt' | 'getStatus' | 'reconcile' |
  'listWorkspaces' | 'inspectWorkspace' | 'retainWorkspace' | 'cleanWorkspace' | 'doctorWorkspaces'>
  & Pick<ThreadOSRuntimeService, 'listChangeSets' | 'inspectChangeSet' | 'inspectChangeSetById' | 'compareChangeSets' | 'selectChangeSet' | 'rejectChangeSet' | 'selectChangeSetById' | 'rejectChangeSetById'>
  & Pick<ThreadOSRuntimeService, 'previewSelectedChangeSet' | 'inspectMergePlan' | 'validateMergePlan' |
    'inspectMergeApprovalSubject' | 'applyMergePlan' | 'inspectMergeResult' | 'inspectMergeRollbackSubject' |
    'rollbackMergeResult' | 'recoverMergeResult' | 'recoverMergeValidation'>

declare global {
  var __THREADOS_RUNTIME_SERVICE__: RuntimeServicePort | undefined
  var __THREADOS_RUN_ROUTE_RUNTIME__: (Pick<RuntimeServiceDependencies, 'dispatch'> & {
    runStep: NonNullable<RuntimeServiceDependencies['runStep']>
    saveArtifacts?: RuntimeServiceDependencies['saveArtifacts']
    saveRunArtifacts?: RuntimeServiceDependencies['saveArtifacts']
  }) | undefined
}

export async function getApiRuntimeService(
  basePath: string,
  options: RuntimeFactoryOptions = {},
): Promise<RuntimeServicePort> {
  if (globalThis.__THREADOS_RUNTIME_SERVICE__) return globalThis.__THREADOS_RUNTIME_SERVICE__
  const legacy = globalThis.__THREADOS_RUN_ROUTE_RUNTIME__
  const saveArtifacts = legacy?.saveArtifacts ?? legacy?.saveRunArtifacts
  const dependencies = legacy ? {
    ...options.dependencies,
    dispatch: legacy.dispatch,
    ...(saveArtifacts ? { saveArtifacts } : {}),
  } : options.dependencies
  return await getThreadOSRuntimeService(basePath, {
    ...options,
    dependencies,
    testCompatibility: legacy
      ? { runStep: legacy.runStep }
      : options.testCompatibility,
  })
}

export function resolveRuntimeContext(
  request: Request,
  session: AuthSession,
  policyConfirmed = false,
): RuntimeCommandContext {
  const supplied = request.headers.get('idempotency-key')
  if (supplied !== null && supplied.trim().length === 0) {
    throw new RuntimeServiceError('VALIDATION_ERROR', 'Idempotency-Key must not be blank')
  }
  return {
    actor: session.email,
    interface: 'api',
    idempotencyKey: supplied?.trim() ?? randomUUID(),
    policyConfirmed,
    requestId: request.headers.get('x-request-id')?.trim() || undefined,
  }
}

export function assertRuntimeProcessControlsAllowed(): void {
  if (!allowHostedProcessControls()) {
    throw new RuntimeServiceError(
      'PROCESS_CONTROL_DISABLED',
      'Process controls are disabled in hosted mode for the thredOS Desktop launch',
    )
  }
}

export function runtimeJson(
  body: unknown,
  status: number,
  idempotencyKey?: string,
  location?: string,
): NextResponse {
  const response = NextResponse.json(body, { status })
  if (idempotencyKey) response.headers.set('Idempotency-Key', idempotencyKey)
  if (location) response.headers.set('Location', location)
  return response
}

const ERROR_STATUS: Record<string, number> = {
  VALIDATION_ERROR: 400,
  AGENT_REGISTRATION_REQUIRED: 400,
  AGENT_NOT_REGISTERED: 404,
  AGENT_REGISTRATION_INVALID: 400,
  AGENT_COMPOSITION_MISMATCH: 409,
  AGENT_IDENTITY_CHANGED: 409,
  POLICY_DENIED: 403,
  PROCESS_CONTROL_DISABLED: 403,
  POLICY_CONFIRMATION_REQUIRED: 409,
  RUN_NOT_FOUND: 404,
  RUNTIME_TARGET_NOT_FOUND: 404,
  ATTEMPT_NOT_FOUND: 404,
  WORKSPACE_NOT_FOUND: 404,
  CHANGE_SET_NOT_FOUND: 404,
  CHANGE_SET_REVISION_CONFLICT: 409,
  CHANGE_SET_INVALID_TRANSITION: 409,
  CHANGE_SET_IDENTITY_MISMATCH: 409,
  CHANGE_SET_BASELINE_MISMATCH: 409,
  CHANGE_SET_TRACE_PERSIST_FAILED: 500,
  CHANGE_SET_NOT_READY: 409,
  CHANGE_SET_NOT_REVEALED: 403,
  CHANGE_SET_SCHEMA_UPGRADE_REQUIRED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  ATTEMPT_NOT_RUNNING: 409,
  INVALID_RUNTIME_TRANSITION: 409,
  RUNTIME_REVISION_CONFLICT: 409,
  MERGE_RESULT_NOT_FOUND: 404,
  MERGE_OPERATOR_REQUIRED: 403,
  MERGE_CONFIRMATION_REQUIRED: 409,
  MERGE_UNSUPPORTED_PLATFORM: 503,
  MERGE_OPERATION_UNSUPPORTED: 422,
  MERGE_RECOVERY_REQUIRED: 409,
  MERGE_APPROVAL_PLAN_CHANGED: 409,
  MERGE_APPROVAL_NOT_FOUND: 409,
  MERGE_APPROVAL_BINDING_MISMATCH: 403,
  MERGE_APPROVAL_EXPIRED: 409,
  MERGE_APPROVAL_ALREADY_CONSUMED: 409,
  MERGE_ROLLBACK_PRECONDITION_FAILED: 409,
  MERGE_RESULT_NOT_ROLLBACKABLE: 409,
  MERGE_PROJECTION_RECOVERY_REQUIRED: 409,
  MERGE_CONFLICT: 409,
  MERGE_PRECONDITION_FAILED: 409,
  MERGE_SELECTION_STALE: 409,
  MERGE_CHANGE_SET_NOT_FOUND: 404,
  MERGE_BASELINE_UNAVAILABLE: 422,
  MERGE_PLAN_PRECONDITION_FAILED: 409,
  MERGE_SOURCE_PATH_CHANGED: 409,
  MERGE_UNSAFE_PREVIEW_STORAGE: 409,
  MERGE_CANDIDATE_CONTENT_UNAVAILABLE: 422,
  MERGE_PREVIEW_QUOTA_EXCEEDED: 507,
  MERGE_PLAN_NOT_READY: 409,
  MERGE_PLAN_NOT_FOUND: 404,
  MERGE_PREVIEW_NOT_READY: 409,
  MERGE_STALE_CANONICAL: 409,
  MERGE_PREVIEW_CHANGED: 409,
  MERGE_CONFLICTS_UNRESOLVED: 409,
  MERGE_IDEMPOTENCY_CONFLICT: 409,
  MERGE_APPLY_CAPABILITY_UNAVAILABLE: 503,
  MERGE_VALIDATION_FAILED: 422,
  MERGE_VALIDATION_EVIDENCE_MISSING: 409,
  MERGE_VALIDATION_RECOVERY_REQUIRED: 409,
  MERGE_VALIDATION_CONFIG_CHANGED: 409,
  MERGE_VALIDATION_POLICY_DENIED: 403,
  MERGE_EVIDENCE_UNAVAILABLE: 503,
  SNAPSHOT_SOURCE_CHANGED: 409,
  SNAPSHOT_SOURCE_BUSY: 409,
  SNAPSHOT_REQUIRED: 422,
  WORKSPACE_REQUIRED: 422,
  WORKSPACE_MANIFEST_INVALID: 422,
  WORKSPACE_BOOTSTRAP_FAILED: 422,
  CANONICAL_WORKSPACE_MUTATED: 409,
  WORKSPACE_NOT_CLEANABLE: 409,
  PROCESS_CONTROL_FAILED: 502,
  PROCESS_LOST: 502,
  AGENT_UNAVAILABLE: 503,
  WORKSPACE_PROVISION_FAILED: 503,
  PARALLEL_RUNTIME_UNAVAILABLE: 503,
  WORKSPACE_QUOTA_EXCEEDED: 507,
}

export function handleRuntimeError(error: unknown, idempotencyKey?: string): NextResponse {
  let code = 'INTERNAL_ERROR'
  let message = 'Internal server error'
  if (error instanceof ZodError || error instanceof SyntaxError) {
    code = 'VALIDATION_ERROR'
    message = error instanceof ZodError
      ? error.issues.map(issue => issue.message).join(', ')
      : 'Request body must be valid JSON'
  } else if (error instanceof RuntimeServiceError || error instanceof RuntimeRepositoryError) {
    code = error.code
    message = error.message
  } else {
    console.error('[runtime-api] Internal error:', error instanceof Error ? error.stack ?? error.message : String(error))
  }
  return runtimeJson({ error: message, code }, ERROR_STATUS[code] ?? 500, idempotencyKey)
}

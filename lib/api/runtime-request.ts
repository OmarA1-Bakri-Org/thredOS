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
  'cancelRun' | 'cancelAttempt' | 'retryAttempt' | 'findLatestAttempt' | 'getStatus' | 'reconcile'>

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
  IDEMPOTENCY_CONFLICT: 409,
  ATTEMPT_NOT_RUNNING: 409,
  INVALID_RUNTIME_TRANSITION: 409,
  RUNTIME_REVISION_CONFLICT: 409,
  MERGE_CONFLICT: 409,
  MERGE_PRECONDITION_FAILED: 409,
  SNAPSHOT_SOURCE_CHANGED: 409,
  SNAPSHOT_SOURCE_BUSY: 409,
  SNAPSHOT_REQUIRED: 422,
  WORKSPACE_REQUIRED: 422,
  WORKSPACE_MANIFEST_INVALID: 422,
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

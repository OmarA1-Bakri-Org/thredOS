import { randomUUID } from 'crypto'
import { getThreadOSRuntimeService } from '../runtime/factory'
import { RuntimeServiceError } from '../runtime/errors'
import type { ThreadOSRuntimeService } from '../runtime/service'
import type { RuntimeCommandContext, RuntimeServiceDependencies } from '../runtime/service-types'
import type { CLIOptions } from './formatters/runtime'

export type CLIRuntimeService = Pick<ThreadOSRuntimeService,
  'startRun' | 'runAndWait' | 'listRuns' | 'inspectRun' | 'inspectAttempt' |
  'cancelRun' | 'cancelAttempt' | 'retryAttempt' | 'findLatestAttempt' | 'getStatus' | 'reconcile'>

interface LegacyCLIRunRuntime {
  dispatch: RuntimeServiceDependencies['dispatch']
  runStep: RuntimeServiceDependencies['runStep']
  saveRunArtifacts: RuntimeServiceDependencies['saveArtifacts']
}

declare global {
  var __THREADOS_CLI_RUNTIME_SERVICE__: Partial<CLIRuntimeService> | undefined
  var __THREADOS_CLI_RUN_RUNTIME__: LegacyCLIRunRuntime | undefined
}

export async function getCLIRuntimeService(basePath: string): Promise<CLIRuntimeService> {
  if (globalThis.__THREADOS_CLI_RUNTIME_SERVICE__) {
    return globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ as CLIRuntimeService
  }
  const legacy = globalThis.__THREADOS_CLI_RUN_RUNTIME__
  return await getThreadOSRuntimeService(basePath, legacy ? {
    dependencies: {
      dispatch: legacy.dispatch,
      runStep: legacy.runStep,
      saveArtifacts: legacy.saveRunArtifacts,
    },
  } : {})
}

export function createCLIContext(options: CLIOptions): RuntimeCommandContext {
  if (options.idempotencyKey !== undefined && options.idempotencyKey.trim().length === 0) {
    throw new RuntimeServiceError('VALIDATION_ERROR', 'Idempotency key must not be blank')
  }
  const idempotencyKey = options.idempotencyKey?.trim() ?? randomUUID()
  return {
    actor: 'local@thredos',
    interface: 'cli',
    idempotencyKey,
    policyConfirmed: options.policyConfirmed === true,
  }
}

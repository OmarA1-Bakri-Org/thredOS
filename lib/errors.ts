import type { ZodError } from 'zod'

/**
 * Base error class for thredOS
 * All custom errors extend this class for consistent error handling
 */
export class ThredOSError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message)
    this.name = 'ThredOSError'
  }
}

export { ThredOSError as ThreadOSError }

/**
 * Thrown when unable to connect to mprocs server
 */
export class MprocsConnectionError extends ThredOSError {
  constructor(address: string) {
    super(`Failed to connect to mprocs server at ${address}`, 'MPROCS_CONNECTION_FAILED')
    this.name = 'MprocsConnectionError'
  }
}

/**
 * Thrown when sequence.yaml validation fails
 */
export class SequenceValidationError extends ThredOSError {
  constructor(public readonly zodErrors: ZodError) {
    super(
      `Sequence validation failed: ${zodErrors.issues.map(e => e.message).join(', ')}`,
      'SEQUENCE_VALIDATION_FAILED'
    )
    this.name = 'SequenceValidationError'
  }
}

/**
 * Thrown when a step cannot be found by ID
 */
export class StepNotFoundError extends ThredOSError {
  constructor(stepId: string) {
    super(`Step not found: ${stepId}`, 'STEP_NOT_FOUND')
    this.name = 'StepNotFoundError'
  }
}

/**
 * Thrown when a circular dependency is detected in the DAG
 */
export class CircularDependencyError extends ThredOSError {
  constructor(cycle: string[]) {
    super(`Circular dependency detected: ${cycle.join(' -> ')}`, 'CIRCULAR_DEPENDENCY')
    this.name = 'CircularDependencyError'
  }
}

/**
 * Thrown when a gate cannot be found by ID
 */
export class GateNotFoundError extends ThredOSError {
  constructor(gateId: string) {
    super(`Gate not found: ${gateId}`, 'GATE_NOT_FOUND')
    this.name = 'GateNotFoundError'
  }
}

/**
 * Thrown when a group cannot be found by ID
 */
export class GroupNotFoundError extends ThredOSError {
  constructor(groupId: string) {
    super(`Group not found: ${groupId}`, 'GROUP_NOT_FOUND')
    this.name = 'GroupNotFoundError'
  }
}

/**
 * Thrown when a dependency is not found
 */
export class DependencyNotFoundError extends ThredOSError {
  constructor(stepId: string, depId: string) {
    super(`Dependency '${depId}' not found on step '${stepId}'`, 'DEPENDENCY_NOT_FOUND')
    this.name = 'DependencyNotFoundError'
  }
}

/**
 * Thrown when a template type is invalid
 */
export class InvalidTemplateError extends ThredOSError {
  constructor(templateType: string) {
    super(`Invalid template type: ${templateType}`, 'INVALID_TEMPLATE')
    this.name = 'InvalidTemplateError'
  }
}

export class ProcessTimeoutError extends ThredOSError {
  constructor(stepId: string, timeoutMs: number) {
    super(`Step '${stepId}' timed out after ${timeoutMs}ms`, 'PROCESS_TIMEOUT')
    this.name = 'ProcessTimeoutError'
  }
}

/**
 * Thrown when an agent CLI is not found on the system
 */
export class AgentNotFoundError extends ThredOSError {
  constructor(model: string, hint?: string) {
    const message = hint
      ? `Agent '${model}' not found. ${hint}`
      : `Agent '${model}' not found on PATH`
    super(message, 'AGENT_NOT_FOUND')
    this.name = 'AgentNotFoundError'
  }
}

/**
 * Thrown when a step's prompt file is missing
 */
export class PromptNotFoundError extends ThredOSError {
  constructor(stepId: string, path: string) {
    super(`Prompt file not found for step '${stepId}': ${path}`, 'PROMPT_NOT_FOUND')
    this.name = 'PromptNotFoundError'
  }
}

export class ThreadSurfaceNotFoundError extends ThredOSError {
  constructor(surfaceId: string) {
    super(`Thread surface ${surfaceId} not found`, 'THREAD_SURFACE_NOT_FOUND')
    this.name = 'ThreadSurfaceNotFoundError'
  }
}

export class ThreadSurfaceRunNotFoundError extends ThredOSError {
  constructor(surfaceId: string, runId: string) {
    super(`Run ${runId} for surface ${surfaceId} not found`, 'THREAD_SURFACE_RUN_NOT_FOUND')
    this.name = 'ThreadSurfaceRunNotFoundError'
  }
}

export class ThreadSurfaceAlreadyExistsError extends ThredOSError {
  constructor(surfaceId: string) {
    super(`Thread surface already exists: ${surfaceId}`, 'THREAD_SURFACE_ALREADY_EXISTS')
    this.name = 'ThreadSurfaceAlreadyExistsError'
  }
}

export class InvalidThreadSurfaceMergeError extends ThredOSError {
  constructor(message: string) {
    super(message, 'INVALID_THREAD_SURFACE_MERGE')
    this.name = 'InvalidThreadSurfaceMergeError'
  }
}

export class ThreadSurfaceRunScopeNotFoundError extends ThredOSError {
  constructor(runId: string) {
    super(`Run not found: ${runId}`, 'THREAD_SURFACE_RUN_NOT_FOUND')
    this.name = 'ThreadSurfaceRunScopeNotFoundError'
  }
}

export class ThreadSurfaceStateConflictError extends ThredOSError {
  constructor() {
    super(
      'Thread surface state was modified concurrently. Reload the latest runtime state and retry your change.',
      'THREAD_SURFACE_STATE_CONFLICT',
    )
    this.name = 'ThreadSurfaceStateConflictError'
  }
}

export class InvalidLlmProviderError extends ThredOSError {
  constructor(provider: string) {
    super(`Unsupported LLM provider: ${provider}`, 'INVALID_LLM_PROVIDER')
    this.name = 'InvalidLlmProviderError'
  }
}

export class MissingLlmProviderConfigError extends ThredOSError {
  constructor(envVar: string, provider: string) {
    super(`Missing required ${provider} configuration: ${envVar}`, 'MISSING_LLM_PROVIDER_CONFIG')
    this.name = 'MissingLlmProviderConfigError'
  }
}

export class SpawnDepthExceededError extends ThredOSError {
  constructor(currentDepth: number, maxDepth: number) {
    super(`Spawn depth ${currentDepth} exceeds maximum allowed depth of ${maxDepth}`, 'SPAWN_DEPTH_EXCEEDED')
    this.name = 'SpawnDepthExceededError'
  }
}

export class SpawnLimitExceededError extends ThredOSError {
  constructor(limitType: 'children' | 'total', current: number, max: number) {
    super(`Spawn limit exceeded: ${limitType} count ${current} exceeds maximum of ${max}`, 'SPAWN_LIMIT_EXCEEDED')
    this.name = 'SpawnLimitExceededError'
  }
}

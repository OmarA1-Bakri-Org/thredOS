import type { ZodError } from 'zod'

/**
 * Base error class for ThreadOS
 * All custom errors extend this class for consistent error handling
 */
export class ThreadOSError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message)
    this.name = 'ThreadOSError'
  }
}

/**
 * Thrown when unable to connect to mprocs server
 */
export class MprocsConnectionError extends ThreadOSError {
  constructor(address: string) {
    super(`Failed to connect to mprocs server at ${address}`, 'MPROCS_CONNECTION_FAILED')
    this.name = 'MprocsConnectionError'
  }
}

/**
 * Thrown when sequence.yaml validation fails
 */
export class SequenceValidationError extends ThreadOSError {
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
export class StepNotFoundError extends ThreadOSError {
  constructor(stepId: string) {
    super(`Step not found: ${stepId}`, 'STEP_NOT_FOUND')
    this.name = 'StepNotFoundError'
  }
}

/**
 * Thrown when a circular dependency is detected in the DAG
 */
export class CircularDependencyError extends ThreadOSError {
  constructor(cycle: string[]) {
    super(`Circular dependency detected: ${cycle.join(' -> ')}`, 'CIRCULAR_DEPENDENCY')
    this.name = 'CircularDependencyError'
  }
}

/**
 * Thrown when a gate cannot be found by ID
 */
export class GateNotFoundError extends ThreadOSError {
  constructor(gateId: string) {
    super(`Gate not found: ${gateId}`, 'GATE_NOT_FOUND')
    this.name = 'GateNotFoundError'
  }
}

/**
 * Thrown when a group cannot be found by ID
 */
export class GroupNotFoundError extends ThreadOSError {
  constructor(groupId: string) {
    super(`Group not found: ${groupId}`, 'GROUP_NOT_FOUND')
    this.name = 'GroupNotFoundError'
  }
}

/**
 * Thrown when a dependency is not found
 */
export class DependencyNotFoundError extends ThreadOSError {
  constructor(stepId: string, depId: string) {
    super(`Dependency '${depId}' not found on step '${stepId}'`, 'DEPENDENCY_NOT_FOUND')
    this.name = 'DependencyNotFoundError'
  }
}

/**
 * Thrown when a template type is invalid
 */
export class InvalidTemplateError extends ThreadOSError {
  constructor(templateType: string) {
    super(`Invalid template type: ${templateType}`, 'INVALID_TEMPLATE')
    this.name = 'InvalidTemplateError'
  }
}

export class ProcessTimeoutError extends ThreadOSError {
  constructor(stepId: string, timeoutMs: number) {
    super(`Step '${stepId}' timed out after ${timeoutMs}ms`, 'PROCESS_TIMEOUT')
    this.name = 'ProcessTimeoutError'
  }
}

/**
 * Thrown when an agent CLI is not found on the system
 */
export class AgentNotFoundError extends ThreadOSError {
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
export class PromptNotFoundError extends ThreadOSError {
  constructor(stepId: string, path: string) {
    super(`Prompt file not found for step '${stepId}': ${path}`, 'PROMPT_NOT_FOUND')
    this.name = 'PromptNotFoundError'
  }
}

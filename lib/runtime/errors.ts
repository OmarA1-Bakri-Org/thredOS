import type { RuntimeErrorCode } from './error-codes'

export class RuntimeServiceError extends Error {
  constructor(
    public readonly code: RuntimeErrorCode | 'PARALLEL_RUNTIME_UNAVAILABLE' | 'RUNTIME_TARGET_NOT_FOUND',
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'RuntimeServiceError'
  }
}

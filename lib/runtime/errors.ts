import type { RuntimeErrorCode } from './error-codes'

export class RuntimeServiceError extends Error {
  constructor(
    public readonly code: RuntimeErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'RuntimeServiceError'
  }
}

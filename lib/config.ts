/**
 * Get the base path for ThreadOS operations.
 * API routes use THREADOS_BASE_PATH env var; CLI uses process.cwd().
 */
export function getBasePath(): string {
  return process.env.THREDOS_BASE_PATH || process.env.THREADOS_BASE_PATH || process.cwd()
}

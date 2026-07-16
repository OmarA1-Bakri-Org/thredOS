import type { RawProcessResult, RunningProcessHandle } from '../runner/process-handle'
import { ProcessSpawnError, type RunnerConfig, type RunResult } from '../runner/wrapper'

function compatibilityPid(processId: string): number {
  let hash = 0
  for (const character of processId) {
    hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0
  }
  return 900_000_000 + (Math.abs(hash) % 90_000_000)
}

function rawCompatibilityResult(result: RunResult): RawProcessResult {
  return { ...result, signal: null }
}

/**
 * Test-only bridge for legacy terminal-runner fixtures.
 *
 * Production runtime construction must provide the real `startProcess` boundary.
 */
export function createTestCompatibilityStartProcess(
  runStep: (config: RunnerConfig) => Promise<RunResult>,
): (config: RunnerConfig) => Promise<RunningProcessHandle> {
  return async config => {
    const processId = config.processId
    if (!processId) throw new Error('compatibility process launch requires processId')
    const result = rawCompatibilityResult(await runStep(config))
    if (result.status === 'ERROR' && result.exitCode === null && result.signal === null) {
      throw new ProcessSpawnError(
        result.stderr || `compatibility process ${processId} returned no exit evidence`,
        result,
      )
    }
    return {
      processId,
      pid: compatibilityPid(processId),
      result: Promise.resolve(result),
      cancel: async signal => ({
        success: false,
        code: 'PROCESS_CONTROL_FAILED',
        message: 'Compatibility runStep adapter has no live process control handle',
        signal: signal ?? 'SIGTERM',
      }),
    }
  }
}

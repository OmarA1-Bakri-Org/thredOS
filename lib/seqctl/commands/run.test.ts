import { afterEach, describe, expect, test } from 'bun:test'
import { WorkflowRunStatusSchema, type WorkflowRunTarget } from '../../runtime/schema'
import { RuntimeJsonEnvelopeSchema } from '../runtime-json-schema'
import { runCommand } from './run'

const options = { json: true, help: false, watch: false, basePath: 'C:\\tmp\\threados-cli' }

function successfulResult(target: WorkflowRunTarget) {
  const stepId = target.kind === 'step' ? target.step_id : 'step-a'
  return {
    run: { id: 'run-1', status: 'successful' },
    attempts: [{
      id: 'attempt-1', step_id: stepId, status: 'completed',
      duration_ms: 12, artifact_manifest_ref: '.threados/runs/run-1/artifact.json',
    }],
    replayed: false,
  } as never
}

async function capture(command: () => Promise<void>): Promise<string[]> {
  const lines: string[] = []
  const originalLog = console.log
  const originalError = console.error
  console.log = (...args: unknown[]) => lines.push(args.map(String).join(' '))
  console.error = (...args: unknown[]) => lines.push(args.map(String).join(' '))
  try {
    await command()
  } finally {
    console.log = originalLog
    console.error = originalError
  }
  return lines
}

afterEach(() => {
  delete globalThis.__THREADOS_CLI_RUNTIME_SERVICE__
  process.exitCode = 0
})

describe('run command service adapter', () => {
  test.each([
    ['step', ['step-a'], { kind: 'step', step_id: 'step-a' }],
    ['runnable', [], { kind: 'runnable' }],
    ['group', ['group-a'], { kind: 'group', group_id: 'group-a' }],
  ] as const)('maps run %s to the M0 sequential service request', async (subcommand, args, target) => {
    let request: unknown
    globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = {
      runAndWait: async (input, context) => {
        request = { input, context }
        return successfulResult(target)
      },
    }
    const lines = await capture(async () => {
      await runCommand(subcommand, [...args], { ...options, idempotencyKey: 'run-key' })
    })

    expect(request).toEqual({
      input: {
        sequence_id: '$current',
        target,
        strategy: 'sequential',
        max_concurrency: 1,
        allow_empty: target.kind === 'runnable' || target.kind === 'group',
      },
      context: {
        actor: 'local@thredos', interface: 'cli', idempotencyKey: 'run-key', policyConfirmed: false,
      },
    })
    expect(RuntimeJsonEnvelopeSchema.parse(JSON.parse(lines[0])).success).toBe(true)
  })

  test('preserves useful human output for run step', async () => {
    globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = {
      runAndWait: async input => successfulResult(input.target),
    }
    const lines = await capture(async () => {
      await runCommand('step', ['step-a'], { ...options, json: false })
    })
    expect(lines.join('\n')).toContain("Step 'step-a' completed successfully")
    expect(lines.join('\n')).toContain('Duration: 12ms')
    expect(lines.join('\n')).toContain('Artifacts:')
  })

  test('list and inspect expose canonical projections', async () => {
    const projection = { run: { id: 'run-1', status: 'successful' }, attempts: [] } as never
    const calls: string[] = []
    globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = {
      listRuns: async () => { calls.push('list'); return [projection] },
      inspectRun: async runId => { calls.push(`inspect:${runId}`); return projection },
    }
    await capture(async () => runCommand('list', [], options))
    await capture(async () => runCommand('inspect', ['run-1'], options))
    expect(calls).toEqual(['list', 'inspect:run-1'])
  })

  test('run cancellation is a successful command even though the run is cancelled', async () => {
    globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = {
      cancelRun: async runId => ({ id: runId, status: 'cancelled' }) as never,
      inspectRun: async runId => ({ run: { id: runId, status: 'cancelled' }, attempts: [] }) as never,
    }
    const lines = await capture(async () => runCommand('cancel', ['run-1'], options))
    const envelope = RuntimeJsonEnvelopeSchema.parse(JSON.parse(lines[0]))
    expect(envelope.success).toBe(true)
    expect(process.exitCode).toBe(0)
  })

  test('unknown subcommand emits a versioned validation failure without process.exit', async () => {
    globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = {}
    const lines = await capture(async () => runCommand('unknown', [], options))
    expect(RuntimeJsonEnvelopeSchema.parse(JSON.parse(lines[0]))).toEqual({
      schemaVersion: 1,
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Unknown subcommand. Usage: thread run step|runnable|group|list|inspect|cancel',
      },
    })
    expect(process.exitCode).not.toBe(0)
  })

  test('preserves a canonical typed attempt failure and its documented exit code', async () => {
    globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = {
      runAndWait: async () => ({
        run: { id: 'run-1', status: 'failed', error_code: null },
        attempts: [{
          id: 'attempt-1', step_id: 'step-a', status: 'failed',
          error_code: 'POLICY_DENIED', error_message: 'executable denied by policy',
        }],
        replayed: false,
      }) as never,
    }
    const lines = await capture(async () => runCommand('step', ['step-a'], options))
    expect(RuntimeJsonEnvelopeSchema.parse(JSON.parse(lines[0]))).toEqual({
      schemaVersion: 1,
      success: false,
      error: { code: 'POLICY_DENIED', message: 'executable denied by policy' },
    })
    expect(process.exitCode).toBe(3)
  })

  test.each(WorkflowRunStatusSchema.options)(
    'maps workflow status %s to truthful envelope and exit status',
    async status => {
      globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = {
        runAndWait: async () => ({
          run: { id: 'run-status', status, error_code: null }, attempts: [], replayed: false,
        }) as never,
      }
      const lines = await capture(async () => runCommand('step', ['step-a'], options))
      const envelope = RuntimeJsonEnvelopeSchema.parse(JSON.parse(lines[0]))
      expect(envelope.success).toBe(status === 'successful')
      expect(process.exitCode).toBe(status === 'successful' ? 0 : 6)
    },
  )

  test.each([
    ['POLICY_DENIED', 'policy denied', 3],
    ['POLICY_CONFIRMATION_REQUIRED', 'confirmation required', 3],
    ['PROCESS_CONTROL_FAILED', 'controller failed', 7],
  ] as const)('preserves typed runtime failure %s', async (code, message, exitCode) => {
    globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = {
      runAndWait: async () => ({
        run: { id: 'run-typed', status: 'failed', error_code: code, error_message: message },
        attempts: [], replayed: false,
      }) as never,
    }
    const lines = await capture(async () => runCommand('step', ['step-a'], options))
    expect(RuntimeJsonEnvelopeSchema.parse(JSON.parse(lines[0]))).toEqual({
      schemaVersion: 1, success: false, error: { code, message },
    })
    expect(process.exitCode).toBe(exitCode)
  })
})

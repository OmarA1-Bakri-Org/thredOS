import { afterEach, describe, expect, test } from 'bun:test'
import type { RuntimeCommandContext } from '../../runtime/service-types'
import { main } from '../index'
import { RuntimeJsonEnvelopeSchema } from '../runtime-json-schema'
import { workspaceCommand } from './workspace'

const options = {
  json: true,
  help: false,
  watch: false,
  basePath: 'C:\\tmp\\threados-workspace-cli',
}

function captureLog(): { lines: string[]; restore: () => void } {
  const lines: string[] = []
  const original = console.log
  console.log = (line: string) => lines.push(line)
  return { lines, restore: () => { console.log = original } }
}

function inspection(status = 'retained') {
  return {
    schema_version: 1,
    workspace: {
      id: 'workspace-1',
      status,
      workflow_run_id: 'run-1',
      attempt_id: 'attempt-1',
      snapshot_id: 'snapshot-1',
      isolation_label: 'THREADOS_SCOPED',
    },
    manifest_hash: 'sha256:manifest',
    snapshot: null,
    attempt: null,
    processes: [],
    verification: { exists: status !== 'cleaned', manifestMatches: true, hasUsefulOutput: false },
    bootstrap: [],
    diagnostics: [],
  } as never
}

afterEach(() => {
  delete globalThis.__THREADOS_CLI_RUNTIME_SERVICE__
  process.exitCode = 0
})

describe('workspace command', () => {
  test('is registered in the CLI and included in help', async () => {
    globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = {
      listWorkspaces: async () => [],
    }
    const capture = captureLog()
    try {
      await main(['workspace', 'list', '--json'])
      await main(['--help'])
    } finally {
      capture.restore()
    }

    expect(RuntimeJsonEnvelopeSchema.parse(JSON.parse(capture.lines[0]))).toMatchObject({
      success: true,
      data: { workspaces: [] },
    })
    expect(capture.lines[1]).toContain('workspace list|inspect')
    expect(capture.lines[1]).toContain('workspace retain|clean|doctor')
  })

  test('list delegates the optional run filter and emits the JSON envelope', async () => {
    let query: unknown
    globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = {
      listWorkspaces: async value => {
        query = value
        return []
      },
    }
    const capture = captureLog()
    try {
      await workspaceCommand('list', ['--run', 'run-1'], options)
    } finally {
      capture.restore()
    }

    expect(query).toEqual({ runId: 'run-1' })
    expect(RuntimeJsonEnvelopeSchema.parse(JSON.parse(capture.lines[0]))).toEqual({
      schemaVersion: 1,
      success: true,
      data: { workspaces: [] },
    })
    expect(process.exitCode).toBe(0)
  })

  test('inspect, retain and clean delegate only through the runtime service', async () => {
    const calls: Array<{ action: string; id: string; context?: RuntimeCommandContext }> = []
    globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = {
      inspectWorkspace: async id => {
        calls.push({ action: 'inspect', id })
        return inspection()
      },
      retainWorkspace: async (id, context) => {
        calls.push({ action: 'retain', id, context })
        return inspection()
      },
      cleanWorkspace: async (id, context) => {
        calls.push({ action: 'clean', id, context })
        return inspection('cleaned')
      },
    }
    const capture = captureLog()
    try {
      await workspaceCommand('inspect', ['workspace-1'], options)
      await workspaceCommand('retain', ['workspace-1'], {
        ...options,
        idempotencyKey: 'retain-key',
      })
      await workspaceCommand('clean', ['workspace-1'], {
        ...options,
        idempotencyKey: 'clean-key',
        policyConfirmed: true,
      })
    } finally {
      capture.restore()
    }

    expect(calls).toEqual([
      { action: 'inspect', id: 'workspace-1' },
      {
        action: 'retain',
        id: 'workspace-1',
        context: expect.objectContaining({
          interface: 'cli',
          idempotencyKey: 'retain-key',
          policyConfirmed: false,
        }),
      },
      {
        action: 'clean',
        id: 'workspace-1',
        context: expect.objectContaining({
          interface: 'cli',
          idempotencyKey: 'clean-key',
          policyConfirmed: true,
        }),
      },
    ])
    expect(capture.lines).toHaveLength(3)
    capture.lines.forEach(line => {
      expect(RuntimeJsonEnvelopeSchema.parse(JSON.parse(line)).success).toBe(true)
    })
  })

  test('doctor returns sanitized service output and invalid arguments fail predictably', async () => {
    globalThis.__THREADOS_CLI_RUNTIME_SERVICE__ = {
      doctorWorkspaces: async () => ({
        healthy: false,
        checkedRecords: 1,
        checkedDirectories: 1,
        issues: [{
          code: 'WORKSPACE_TREE_MISSING',
          workspaceId: 'workspace-1',
          path: null,
          message: 'workspace tree missing',
        }],
      }),
      listWorkspaces: async () => [],
    }
    const capture = captureLog()
    try {
      await workspaceCommand('doctor', [], options)
      await workspaceCommand('list', ['--unknown'], options)
    } finally {
      capture.restore()
    }

    expect(RuntimeJsonEnvelopeSchema.parse(JSON.parse(capture.lines[0]))).toMatchObject({
      success: true,
      data: { issues: [{ path: null }] },
    })
    expect(RuntimeJsonEnvelopeSchema.parse(JSON.parse(capture.lines[1]))).toEqual({
      schemaVersion: 1,
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Usage: thread workspace list [--run <runId>]',
      },
    })
    expect(process.exitCode).toBe(2)
  })
})

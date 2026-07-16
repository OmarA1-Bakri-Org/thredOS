import { describe, test, expect } from 'bun:test'
import { spawn, type ChildProcess } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, realpathSync } from 'fs'
import { access, writeFile } from 'fs/promises'
import { delimiter, isAbsolute, resolve, win32 } from 'path'
import { fileURLToPath } from 'url'

function processFixture(name: string): string {
  return fileURLToPath(new URL(`../../test/fixtures/process/${name}`, import.meta.url))
}

function resolveNodeFixtureCommand(): string {
  const executableName = process.platform === 'win32' ? 'node.exe' : 'node'
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue
    const candidate = resolve(directory, executableName)
    if (!existsSync(candidate)) continue
    const absolute = realpathSync(candidate)
    if (isAbsolute(absolute)) return absolute
  }
  throw new Error('Unable to resolve an absolute Node executable for process fixtures')
}

const NODE_FIXTURE_COMMAND = resolveNodeFixtureCommand()
const COORDINATOR_TIMEOUT_MS = 55_000
const MAX_COORDINATOR_OUTPUT_BYTES = 1024 * 1024

interface ProcessProofResults {
  cancel: object
  timeout: object
  singleCancel: object
  singleTimeout: object
  failedCancel: object
  failedTaskkill: object
  timedOutTaskkill: {
    control?: {
      success: boolean
      code?: string
      message?: string
      signal?: string
    }
    hookAborted?: boolean
    elapsedMs?: number
    aliveAfterFailure?: boolean
    skipped?: boolean
  }
  deathBeforeEscalationSignal: object
  failedTimeout: object
  spawnError: object
  callbackBounded: {
    status: string
    outputBytes: number
    outputCallbacks: number
    heartbeatCallbacks: number
  }
  callbackSerialized: {
    status: string
    maxActiveCallbacks: number
    completedCallbacks: number
    activeCallbacks: number
  }
  callbackFailed: object
  nonzeroExit: object
  naturalExitBeforeCancel: object
}

async function terminateFixtureTree(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null) return
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot ?? process.env.windir
    if (!systemRoot || !win32.isAbsolute(systemRoot)) {
      child.kill('SIGKILL')
      return
    }
    const command = win32.join(win32.resolve(systemRoot), 'System32', 'taskkill.exe')
    await access(command)
    await new Promise<void>(resolveKill => {
      const killer = spawn(command, ['/PID', String(child.pid), '/T', '/F'], {
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
      })
      const timer = setTimeout(() => {
        killer.kill('SIGKILL')
        resolveKill()
      }, 5_000)
      killer.once('error', () => {
        clearTimeout(timer)
        resolveKill()
      })
      killer.once('close', () => {
        clearTimeout(timer)
        resolveKill()
      })
    })
    return
  }
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    return
  }
  await new Promise(resolveDelay => setTimeout(resolveDelay, 1_000))
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

function appendBounded(current: string, chunk: Buffer | string): string {
  if (current.length >= MAX_COORDINATOR_OUTPUT_BYTES) return current
  return current + chunk.toString().slice(0, MAX_COORDINATOR_OUTPUT_BYTES - current.length)
}

async function runProcessProofCoordinator(): Promise<ProcessProofResults> {
  const child = spawn(NODE_FIXTURE_COMMAND, [
    processFixture('verify-tree-control-coordinator.mjs'),
    process.execPath,
  ], {
    detached: process.platform !== 'win32',
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', chunk => {
    stdout = appendBounded(stdout, chunk)
  })
  child.stderr?.on('data', chunk => {
    stderr = appendBounded(stderr, chunk)
  })

  return new Promise((resolveProof, rejectProof) => {
    let settled = false
    let timedOut = false
    const finish = (error: Error | null, value?: ProcessProofResults): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) rejectProof(error)
      else if (value) resolveProof(value)
      else rejectProof(new Error('Process proof coordinator completed without a result'))
    }
    const timer = setTimeout(() => {
      timedOut = true
      void terminateFixtureTree(child).then(
        () => finish(new Error(`Process proof coordinator timed out after ${COORDINATOR_TIMEOUT_MS}ms${stderr ? `: ${stderr}` : ''}`)),
        error => finish(new Error(`Process proof coordinator timed out and cleanup failed: ${error.message}`)),
      )
    }, COORDINATOR_TIMEOUT_MS)

    child.once('error', error => {
      void terminateFixtureTree(child).finally(() => {
        finish(new Error(`Process proof coordinator failed to spawn: ${error.message}`))
      })
    })
    child.once('close', code => {
      if (timedOut) return
      if (code !== 0) {
        finish(new Error(stderr || `Process proof coordinator exited ${code}`))
        return
      }
      try {
        finish(null, JSON.parse(stdout.trim()) as ProcessProofResults)
      } catch (error) {
        finish(new Error(`Process proof coordinator returned invalid JSON: ${(error as Error).message}; stdout=${stdout}; stderr=${stderr}`))
      }
    })
  })
}

async function importActualWrapper() {
  return import('./wrapper')
}

async function expectParentEnvKeysFiltered(keys: string[]): Promise<void> {
  const { runStep } = await importActualWrapper()
  const previous = new Map(keys.map(key => [key, process.env[key]]))
  const sentinels = Object.fromEntries(keys.map(key => [
    key,
    `sentinel-${key}-${Date.now()}-${Math.random()}`,
  ]))
  for (const [key, sentinel] of Object.entries(sentinels)) {
    process.env[key] = sentinel
  }

  try {
    const result = await runStep({
      stepId: 'filter-sensitive-environment',
      runId: 'run-filter',
      command: NODE_FIXTURE_COMMAND,
      args: ['-e', `const sentinels=${JSON.stringify(sentinels)}; process.stdout.write(process.env.MY_VAR === "test-value" && Object.entries(sentinels).every(([key,value]) => process.env[key] !== value) ? "FILTERED" : "LEAKED")`],
      env: { MY_VAR: 'test-value' },
    })
    expect(result.stdout).toBe('FILTERED')
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

describe.serial('runStep', () => {
  test('successful command', async () => {
    const { runStep } = await importActualWrapper()
    const result = await runStep({
      stepId: 'test-step',
      runId: 'run-1',
      command: NODE_FIXTURE_COMMAND,
      args: ['-e', 'process.stdout.write("hello\\n")'],
    })
    expect(result.status).toBe('SUCCESS')
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('hello')
    expect(result.stepId).toBe('test-step')
    expect(result.runId).toBe('run-1')
    expect(result.duration).toBeGreaterThanOrEqual(0)
    expect(result.startTime).toBeInstanceOf(Date)
    expect(result.endTime).toBeInstanceOf(Date)
  })

  test('preserves nonzero exit, stderr, and bounded output evidence', async () => {
    const { runStep } = await importActualWrapper()
    const result = await runStep({
      stepId: 'fail-step',
      runId: 'run-2',
      command: NODE_FIXTURE_COMMAND,
      args: [processFixture('exit-with-code.mjs'), '17', '8192'],
      maxOutputBytes: 128,
    })
    expect(result.status).toBe('FAILED')
    expect(result.exitCode).toBe(17)
    expect(Buffer.byteLength(result.stdout)).toBe(128)
    expect(Buffer.byteLength(result.stderr)).toBe(128)
  })

  test('nonexistent command returns ERROR', async () => {
    const { runStep } = await importActualWrapper()
    // shell: false means spawn emits an error event for not-found commands
    const result = await runStep({
      stepId: 'bad-cmd',
      runId: 'run-5',
      command: 'nonexistent_command_xyz',
    })
    expect(result.status).toBe('ERROR')
    expect(result.exitCode).toBe(null)
  })

  test('materialized script preserves exact UTF-8 bytes and argv boundaries', async () => {
    const { runStep } = await importActualWrapper()
    const content = 'process.stdout.write(JSON.stringify(process.argv.slice(2)))\n'
    const sha256 = `sha256:${createHash('sha256').update(content).digest('hex')}`
    const result = await runStep({
      stepId: 'script-bytes',
      runId: 'run-script-bytes',
      command: NODE_FIXTURE_COMMAND,
      args: ['-e', 'process.stdout.write("legacy")'],
      executablePayload: {
        command: NODE_FIXTURE_COMMAND,
        args: ['quoted value', 'é'],
        cwd: process.cwd(),
        script: { interpreter: NODE_FIXTURE_COMMAND, content, sha256 },
      },
    })

    expect(result.stdout).toBe(JSON.stringify(['quoted value', 'é']))
  })

  test('temp script tampering is rejected immediately before spawn', async () => {
    const wrapper = await importActualWrapper()
    const content = 'process.stdout.write("approved")\n'
    const sha256 = `sha256:${createHash('sha256').update(content).digest('hex')}`
    expect(typeof wrapper.setBeforeExecutableSpawnHookForTests).toBe('function')
    wrapper.setBeforeExecutableSpawnHookForTests(async ({ scriptPath }) => {
      await writeFile(scriptPath, 'process.stdout.write("tampered")\n')
    })

    try {
      await expect(wrapper.runStep({
        stepId: 'script-tamper',
        runId: 'run-script-tamper',
        command: NODE_FIXTURE_COMMAND,
        args: [],
        executablePayload: {
          command: NODE_FIXTURE_COMMAND,
          args: [],
          cwd: process.cwd(),
          script: { interpreter: NODE_FIXTURE_COMMAND, content, sha256 },
        },
      })).rejects.toThrow('hash')
    } finally {
      wrapper.setBeforeExecutableSpawnHookForTests(null)
    }
  })

  test('runner rejects a script interpreter that differs from the payload command', async () => {
    const { runStep } = await importActualWrapper()
    const content = 'process.stdout.write("must-not-run")\n'
    const sha256 = `sha256:${createHash('sha256').update(content).digest('hex')}`

    await expect(runStep({
      stepId: 'interpreter-mismatch',
      runId: 'run-interpreter-mismatch',
      command: 'node',
      args: [],
      executablePayload: {
        command: NODE_FIXTURE_COMMAND,
        args: [],
        cwd: process.cwd(),
        script: {
          interpreter: 'threados-mismatched-interpreter-sentinel',
          content,
          sha256,
        },
      },
    })).rejects.toThrow('interpreter')
  })

  test('grants explicit env while filtering sensitive and prefix-matching variables', async () => {
    await expectParentEnvKeysFiltered([
      'AWS_SECRET_ACCESS_KEY',
      'THREADOS_SESSION_SECRET',
      'THREADOS_ACTIVATION_SECRET',
      'THREADOS_BASE_PATH',
      'THREADOS_UNRELATED_SENTINEL',
      'THREDOS_UNRELATED_SENTINEL',
    ])
  })
})

describe.serial('startProcess', () => {
  test('uses a verified absolute System32 taskkill path on Windows', async () => {
    const wrapper = await importActualWrapper()
    expect(typeof wrapper.resolveWindowsTaskkillPath).toBe('function')
    expect(wrapper.resolveWindowsTaskkillPath({ SystemRoot: 'C:\\Windows' }))
      .toBe('C:\\Windows\\System32\\taskkill.exe')
    expect(() => wrapper.resolveWindowsTaskkillPath({ SystemRoot: 'relative-root' }))
      .toThrow('absolute')
  })

  test('proves handle lifecycle, callbacks, cancellation, timeout, and truthful failures in isolated workers', async () => {
    const result = await runProcessProofCoordinator()
    expect(result.cancel).toMatchObject({
      control: { success: true, signal: 'SIGTERM', escalated: true },
      status: 'CANCELLED',
      alive: [false, false, false],
    })
    expect(result.timeout).toEqual({
      timedOut: true,
      alive: [false, false, false],
    })
    expect(result.singleCancel).toMatchObject({
      control: { success: true, signal: 'SIGTERM' },
      status: 'CANCELLED',
      alive: false,
    })
    expect(result.singleTimeout).toEqual({
      timedOut: true,
      alive: false,
    })
    expect(result.failedCancel).toEqual({
      control: {
        success: false,
        code: 'PROCESS_CONTROL_FAILED',
        message: 'simulated tree termination failure',
        signal: 'SIGTERM',
      },
      aliveAfterFailure: true,
    })
    if (process.platform === 'win32') {
      expect(result.failedTaskkill).toEqual({
        control: {
          success: false,
          code: 'PROCESS_CONTROL_FAILED',
          message: 'simulated nonzero taskkill',
          signal: 'SIGKILL',
        },
      })
      expect(result.timedOutTaskkill).toMatchObject({
        control: {
          success: false,
          code: 'PROCESS_CONTROL_FAILED',
          message: 'taskkill timed out after 50ms',
          signal: 'SIGKILL',
        },
        hookAborted: true,
        aliveAfterFailure: true,
      })
      expect(result.timedOutTaskkill.elapsedMs).toBeLessThan(1_000)
    }
    expect(result.deathBeforeEscalationSignal).toEqual({
      control: {
        success: true,
        signal: 'SIGTERM',
        escalated: true,
      },
      status: 'CANCELLED',
      signalCalls: 2,
      alive: false,
    })
    expect(result.failedTimeout).toEqual({
      error: {
        code: 'PROCESS_CONTROL_FAILED',
        message: 'simulated timeout termination failure',
      },
      aliveAfterFailure: true,
    })
    expect(result.spawnError).toEqual({
      code: 'PROCESS_SPAWN_FAILED',
    })
    expect(result.callbackBounded).toMatchObject({
      status: 'SUCCESS',
      outputBytes: 96,
    })
    expect(result.callbackBounded.outputCallbacks).toBeGreaterThan(0)
    expect(result.callbackBounded.outputCallbacks).toBeLessThan(40)
    expect(result.callbackBounded.heartbeatCallbacks).toBeGreaterThan(0)
    expect(result.callbackBounded.heartbeatCallbacks).toBeLessThan(20)
    expect(result.callbackSerialized).toMatchObject({
      status: 'SUCCESS',
      maxActiveCallbacks: 1,
      activeCallbacks: 0,
    })
    expect(result.callbackSerialized.completedCallbacks).toBeGreaterThan(0)
    expect(result.callbackFailed).toEqual({
      code: 'PROCESS_CALLBACK_FAILED',
      message: 'persist output failed',
    })
    expect(result.nonzeroExit).toEqual({
      status: 'FAILED',
      exitCode: 17,
    })
    expect(result.naturalExitBeforeCancel).toEqual({
      control: {
        success: true,
        signal: 'SIGTERM',
        escalated: false,
      },
      status: 'FAILED',
      exitCode: 17,
    })
  }, 65_000)
})

describe('buildExecutionEnv', () => {
  async function getBuilder() {
    const { buildExecutionEnv } = await importActualWrapper()
    return buildExecutionEnv
  }

  test('inherits only the exact portable OS and tooling allowlist', async () => {
    const buildExecutionEnv = await getBuilder()
    const inherited: NodeJS.ProcessEnv = {
      PATH: 'path-sentinel',
      HOME: 'home-sentinel',
      USER: 'user-sentinel',
      SHELL: 'shell-sentinel',
      LANG: 'lang-sentinel',
      LC_ALL: 'lc-all-sentinel',
      LC_CTYPE: 'lc-ctype-sentinel',
      TERM: 'term-sentinel',
      TMPDIR: 'tmpdir-sentinel',
      TMP: 'tmp-sentinel',
      TEMP: 'temp-sentinel',
      NODE_ENV: 'test',
      BUN_INSTALL: 'bun-sentinel',
      SystemRoot: 'system-root-sentinel',
      windir: 'windir-sentinel',
      ComSpec: 'comspec-sentinel',
      PATHEXT: 'pathext-sentinel',
      USERPROFILE: 'profile-sentinel',
      APPDATA: 'appdata-sentinel',
      LOCALAPPDATA: 'local-appdata-sentinel',
      NODE_OPTIONS: '--require sentinel-do-not-load',
      THREADOS_MPROCS_PATH: 'mprocs-secret-sentinel',
      THREADOS_SESSION_SECRET: 'secret-sentinel',
      THREDOS_STRIPE_SECRET_KEY: 'stripe-secret-sentinel',
    }

    const result = buildExecutionEnv(inherited, {})

    for (const key of [
      'PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM',
      'TMPDIR', 'TMP', 'TEMP', 'NODE_ENV', 'BUN_INSTALL', 'SystemRoot', 'windir',
      'ComSpec', 'PATHEXT', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
    ]) {
      expect(result[key]).toBe(inherited[key])
    }
    expect(result.NODE_OPTIONS).toBeUndefined()
    expect(result.THREADOS_MPROCS_PATH).toBeUndefined()
    expect(result.THREADOS_SESSION_SECRET).toBeUndefined()
    expect(result.THREDOS_STRIPE_SECRET_KEY).toBeUndefined()
  })

  test('uses case-insensitive key semantics on Windows', async () => {
    const buildExecutionEnv = await getBuilder()
    const inheritedKey = process.platform === 'win32' ? 'Path' : 'PATH'
    const grantedKey = process.platform === 'win32' ? 'PATH' : 'PATH'
    const result = buildExecutionEnv(
      { NODE_ENV: 'test', [inheritedKey]: 'parent-path-sentinel' },
      { [grantedKey]: 'granted-path-sentinel' },
    )

    expect(result[grantedKey]).toBe('granted-path-sentinel')
    if (process.platform === 'win32' && inheritedKey !== grantedKey) {
      expect(Object.prototype.hasOwnProperty.call(result, inheritedKey)).toBe(false)
    }
  })

  test('explicit trusted grants override inherited values and preserve runtime metadata', async () => {
    const buildExecutionEnv = await getBuilder()
    const result = buildExecutionEnv(
      { NODE_ENV: 'test', PATH: 'parent-path', THREADOS_RUN_ID: 'untrusted-parent-run' },
      {
        PATH: 'granted-path',
        THREADOS_STEP_ID: 'step-a',
        THREADOS_RUN_ID: 'run-a',
        THREADOS_PROMPT_FILE: 'prompt-sentinel',
        THREADOS_EVENT_LOG: 'event-log-sentinel',
        THREADOS_EVENT_EMITTER: 'event-emitter-sentinel',
        THREADOS_BASE_PATH: 'explicit-base-path-sentinel',
      },
    )

    expect(result.PATH).toBe('granted-path')
    expect(result.THREADOS_STEP_ID).toBe('step-a')
    expect(result.THREADOS_RUN_ID).toBe('run-a')
    expect(result.THREADOS_PROMPT_FILE).toBe('prompt-sentinel')
    expect(result.THREADOS_EVENT_LOG).toBe('event-log-sentinel')
    expect(result.THREADOS_EVENT_EMITTER).toBe('event-emitter-sentinel')
    expect(result.THREADOS_BASE_PATH).toBe('explicit-base-path-sentinel')
  })

  test('undefined explicit grants remove inherited values and are omitted', async () => {
    const buildExecutionEnv = await getBuilder()
    const result = buildExecutionEnv(
      { NODE_ENV: 'test', PATH: 'parent-path' },
      { PATH: undefined, THREADOS_EVENT_LOG: undefined },
    )

    expect(Object.prototype.hasOwnProperty.call(result, 'PATH')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(result, 'THREADOS_EVENT_LOG')).toBe(false)
  })

  test('does not log denied secret values', async () => {
    const buildExecutionEnv = await getBuilder()
    const originalLog = console.log
    const originalError = console.error
    const messages: string[] = []
    console.log = (...args: unknown[]) => { messages.push(args.join(' ')) }
    console.error = (...args: unknown[]) => { messages.push(args.join(' ')) }

    try {
      const result = buildExecutionEnv({
        NODE_ENV: 'test',
        THREADOS_SESSION_SECRET: 'never-log-this-sentinel',
      }, {})
      expect(result.THREADOS_SESSION_SECRET).toBeUndefined()
      expect(messages.join('\n')).not.toContain('never-log-this-sentinel')
    } finally {
      console.log = originalLog
      console.error = originalError
    }
  })
})

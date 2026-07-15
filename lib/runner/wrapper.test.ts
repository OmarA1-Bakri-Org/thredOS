import { describe, test, expect } from 'bun:test'
import { ProcessTimeoutError } from '../errors'

async function importActualWrapper() {
  return import(new URL(`./wrapper.ts?cacheBust=${Date.now()}-${Math.random()}`, import.meta.url).href) as Promise<typeof import('./wrapper')>
}

async function expectParentEnvKeyFiltered(key: string): Promise<void> {
  const { runStep } = await importActualWrapper()
  const previous = process.env[key]
  process.env[key] = 'sentinel-placeholder'

  try {
    const result = await runStep({
      stepId: `filter-${key.toLowerCase()}`,
      runId: 'run-filter',
      command: process.execPath,
      args: ['-e', `process.stdout.write(process.env[${JSON.stringify(key)}] === undefined ? "ABSENT" : "PRESENT")`],
    })
    expect(result.stdout).toBe('ABSENT')
  } finally {
    if (previous === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = previous
    }
  }
}

describe('runStep', () => {
  test('successful command', async () => {
    const { runStep } = await importActualWrapper()
    const result = await runStep({
      stepId: 'test-step',
      runId: 'run-1',
      command: process.execPath,
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

  test('failed command', async () => {
    const { runStep } = await importActualWrapper()
    const result = await runStep({
      stepId: 'fail-step',
      runId: 'run-2',
      command: process.execPath,
      args: ['-e', 'process.exit(1)'],
    })
    expect(result.status).toBe('FAILED')
    expect(result.exitCode).toBe(1)
  })

  test('command with stderr', async () => {
    const { runStep } = await importActualWrapper()
    const result = await runStep({
      stepId: 'stderr-step',
      runId: 'run-3',
      command: process.execPath,
      args: ['-e', 'process.stderr.write("error\\n")'],
    })
    expect(result.stderr.trim()).toBe('error')
  })

  test('timeout kills process', async () => {
    const { runStep } = await importActualWrapper()
    await expect(
      runStep({
        stepId: 'timeout-step',
        runId: 'run-4',
        command: process.execPath,
        args: ['-e', 'setTimeout(() => {}, 60000)'],
        timeout: 100,
      })
    ).rejects.toThrow(ProcessTimeoutError)
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

  test('custom env vars', async () => {
    const { runStep } = await importActualWrapper()
    const result = await runStep({
      stepId: 'env-step',
      runId: 'run-6',
      command: process.execPath,
      args: ['-e', 'process.stdout.write(process.env.MY_VAR ?? "")'],
      env: { MY_VAR: 'test-value' },
    })
    expect(result.stdout.trim()).toBe('test-value')
  })

  test('inherited env vars filtered through allowlist', async () => {
    const { runStep } = await importActualWrapper()
    const originalSensitive = process.env.AWS_SECRET_ACCESS_KEY
    process.env.AWS_SECRET_ACCESS_KEY = 'super-secret'

    try {
      const result = await runStep({
        stepId: 'env-filter-step',
        runId: 'run-7',
        command: process.execPath,
        args: ['-e', 'process.stdout.write(process.env.AWS_SECRET_ACCESS_KEY ?? "FILTERED")'],
      })
      expect(result.stdout.trim()).toBe('FILTERED')
    } finally {
      if (originalSensitive !== undefined) {
        process.env.AWS_SECRET_ACCESS_KEY = originalSensitive
      } else {
        delete process.env.AWS_SECRET_ACCESS_KEY
      }
    }
  })

  test('does not inherit THREADOS_SESSION_SECRET', async () => {
    await expectParentEnvKeyFiltered('THREADOS_SESSION_SECRET')
  })

  test('does not inherit THREADOS_ACTIVATION_SECRET', async () => {
    await expectParentEnvKeyFiltered('THREADOS_ACTIVATION_SECRET')
  })

  test('does not inherit THREADOS_BASE_PATH without an explicit grant', async () => {
    await expectParentEnvKeyFiltered('THREADOS_BASE_PATH')
  })

  test('does not prefix-inherit unrelated THREADOS or THREDOS variables', async () => {
    await expectParentEnvKeyFiltered('THREADOS_UNRELATED_SENTINEL')
    await expectParentEnvKeyFiltered('THREDOS_UNRELATED_SENTINEL')
  })
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

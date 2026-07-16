import { existsSync, realpathSync } from 'fs'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { delimiter, isAbsolute, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { ProcessTimeoutError } from '../../../lib/errors'
import {
  runStep,
  setProcessTerminationHookForTests,
  setWindowsTaskkillCommandHookForTests,
  startProcess,
} from '../../../lib/runner/wrapper'

function resolveNode(): string {
  const executableName = process.platform === 'win32' ? 'node.exe' : 'node'
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue
    const candidate = resolve(directory, executableName)
    if (!existsSync(candidate)) continue
    const absolute = realpathSync(candidate)
    if (isAbsolute(absolute)) return absolute
  }
  throw new Error('Unable to resolve Node')
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function forceKill(pid: number | null): Promise<void> {
  if (pid === null || !isAlive(pid)) return
  process.kill(pid, 'SIGKILL')
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline && isAlive(pid)) {
    await new Promise(resolveDelay => setTimeout(resolveDelay, 20))
  }
  if (isAlive(pid)) throw new Error(`Fixture process ${pid} remained alive`)
}

async function waitForPids(path: string): Promise<Record<'root' | 'child' | 'grandchild', number>> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(path, 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await new Promise(resolveDelay => setTimeout(resolveDelay, 20))
    }
  }
  throw new Error('Timed out waiting for process-tree PIDs')
}

async function readPidsIfPresent(
  path: string,
): Promise<Partial<Record<'root' | 'child' | 'grandchild', number>>> {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

async function forceKillRecordedPids(
  pids: Partial<Record<'root' | 'child' | 'grandchild', number>>,
  fallbackPid: number | null = null,
): Promise<void> {
  const recorded = [pids.grandchild, pids.child, pids.root, fallbackPid]
  const unique = [...new Set(recorded.filter((pid): pid is number => typeof pid === 'number'))]
  for (const pid of unique) {
    await forceKill(pid)
  }
}

async function cancelProof(): Promise<object> {
  const directory = await mkdtemp(join(tmpdir(), 'threados-tree-cancel-'))
  const pidFile = join(directory, 'pids.json')
  let handlePid: number | null = null
  let recordedPids: Partial<Record<'root' | 'child' | 'grandchild', number>> = {}
  try {
    const handle = await startProcess({
      stepId: 'tree-cancel',
      runId: 'tree-cancel-run',
      command: resolveNode(),
      args: [fileURLToPath(new URL('./process-tree.mjs', import.meta.url)), 'root', pidFile],
      cancellationGraceMs: 50,
    })
    handlePid = handle.pid
    const pids = await waitForPids(pidFile)
    recordedPids = pids
    const control = await handle.cancel()
    const result = await handle.result
    return {
      control,
      status: result.status,
      alive: Object.values(pids).map(isAlive),
    }
  } finally {
    recordedPids = { ...await readPidsIfPresent(pidFile), ...recordedPids }
    await forceKillRecordedPids(recordedPids, handlePid)
    await rm(directory, { recursive: true, force: true })
  }
}

async function timeoutProof(): Promise<object> {
  const directory = await mkdtemp(join(tmpdir(), 'threados-tree-timeout-'))
  const pidFile = join(directory, 'pids.json')
  let recordedPids: Partial<Record<'root' | 'child' | 'grandchild', number>> = {}
  try {
    let timedOut = false
    try {
      await runStep({
        stepId: 'tree-timeout',
        runId: 'tree-timeout-run',
        command: resolveNode(),
        args: [fileURLToPath(new URL('./process-tree.mjs', import.meta.url)), 'root', pidFile],
        timeout: 1_000,
        cancellationGraceMs: 50,
      })
    } catch (error) {
      timedOut = error instanceof ProcessTimeoutError
      if (!timedOut) throw error
    }
    const pids = await waitForPids(pidFile)
    recordedPids = pids
    return {
      timedOut,
      alive: Object.values(pids).map(isAlive),
    }
  } finally {
    recordedPids = { ...await readPidsIfPresent(pidFile), ...recordedPids }
    await forceKillRecordedPids(recordedPids)
    await rm(directory, { recursive: true, force: true })
  }
}

async function singleCancelProof(): Promise<object> {
  const handle = await startProcess({
    stepId: 'single-cancel',
    runId: 'single-cancel-run',
    command: resolveNode(),
    args: [fileURLToPath(new URL('./long-running.mjs', import.meta.url))],
    cancellationGraceMs: 50,
  })
  const control = await handle.cancel()
  const result = await handle.result
  return {
    control,
    status: result.status,
    alive: handle.pid === null ? false : isAlive(handle.pid),
  }
}

async function singleTimeoutProof(): Promise<object> {
  const directory = await mkdtemp(join(tmpdir(), 'threados-single-timeout-'))
  const pidFile = join(directory, 'pid')
  try {
    let timedOut = false
    try {
      await runStep({
        stepId: 'single-timeout',
        runId: 'single-timeout-run',
        command: resolveNode(),
        args: [fileURLToPath(new URL('./long-running.mjs', import.meta.url)), pidFile, '--ignore-term'],
        timeout: 1_000,
        cancellationGraceMs: 50,
      })
    } catch (error) {
      timedOut = error instanceof ProcessTimeoutError
      if (!timedOut) throw error
    }
    const pid = Number.parseInt(await readFile(pidFile, 'utf8'), 10)
    return { timedOut, alive: isAlive(pid) }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function failedCancelProof(): Promise<object> {
  const handle = await startProcess({
    stepId: 'failed-cancel',
    runId: 'failed-cancel-run',
    command: resolveNode(),
    args: [fileURLToPath(new URL('./long-running.mjs', import.meta.url))],
    cancellationGraceMs: 25,
  })
  setProcessTerminationHookForTests(async () => ({
    success: false,
    code: 'PROCESS_CONTROL_FAILED',
    message: 'simulated tree termination failure',
    signal: 'SIGTERM',
  }))
  try {
    const control = await handle.cancel()
    return {
      control,
      aliveAfterFailure: handle.pid !== null && isAlive(handle.pid),
    }
  } finally {
    setProcessTerminationHookForTests(null)
    await forceKill(handle.pid)
    await handle.result
  }
}

async function failedTaskkillProof(): Promise<object> {
  if (process.platform !== 'win32') return { skipped: true }
  const handle = await startProcess({
    stepId: 'failed-taskkill',
    runId: 'failed-taskkill-run',
    command: resolveNode(),
    args: [fileURLToPath(new URL('./long-running.mjs', import.meta.url))],
    cancellationGraceMs: 25,
  })
  const observedResult = handle.result.catch(error => error)
  setWindowsTaskkillCommandHookForTests(async ({ pid }) => {
    process.kill(pid, 'SIGKILL')
    return { code: 1, stderr: 'simulated nonzero taskkill' }
  })
  try {
    const control = await handle.cancel('SIGKILL')
    await observedResult
    return { control }
  } finally {
    setWindowsTaskkillCommandHookForTests(null)
    await forceKill(handle.pid)
  }
}

async function timedOutTaskkillProof(): Promise<object> {
  if (process.platform !== 'win32') return { skipped: true }
  const handle = await startProcess({
    stepId: 'timed-out-taskkill',
    runId: 'timed-out-taskkill-run',
    command: resolveNode(),
    args: [fileURLToPath(new URL('./long-running.mjs', import.meta.url))],
    cancellationGraceMs: 25,
  })
  let hookAborted = false
  const startedAt = Date.now()
  setWindowsTaskkillCommandHookForTests(({ signal }) => new Promise(() => {
    signal.addEventListener('abort', () => {
      hookAborted = true
    }, { once: true })
  }), 50)
  try {
    const control = await handle.cancel('SIGKILL')
    return {
      control,
      hookAborted,
      elapsedMs: Date.now() - startedAt,
      aliveAfterFailure: handle.pid !== null && isAlive(handle.pid),
    }
  } finally {
    setWindowsTaskkillCommandHookForTests(null)
    await forceKill(handle.pid)
    await handle.result
  }
}

async function deathBeforeEscalationSignalProof(): Promise<object> {
  const handle = await startProcess({
    stepId: 'death-before-escalation-signal',
    runId: 'death-before-escalation-signal-run',
    command: resolveNode(),
    args: [fileURLToPath(new URL('./long-running.mjs', import.meta.url))],
    cancellationGraceMs: 1,
    forceKillWaitMs: 1_000,
  })
  let signalCalls = 0
  setProcessTerminationHookForTests(async (pid, signal) => {
    signalCalls += 1
    if (signal === 'SIGTERM') {
      return { success: true, signaled: true }
    }
    process.kill(pid, 'SIGKILL')
    const deadline = Date.now() + 1_000
    while (isAlive(pid) && Date.now() < deadline) {
      await new Promise(resolveDelay => setTimeout(resolveDelay, 10))
    }
    return { success: true, signaled: false }
  })
  try {
    const control = await handle.cancel()
    const result = await handle.result
    return {
      control,
      status: result.status,
      signalCalls,
      alive: handle.pid === null ? false : isAlive(handle.pid),
    }
  } finally {
    setProcessTerminationHookForTests(null)
    await forceKill(handle.pid)
  }
}

async function failedTimeoutProof(): Promise<object> {
  setProcessTerminationHookForTests(async () => ({
    success: false,
    code: 'PROCESS_CONTROL_FAILED',
    message: 'simulated timeout termination failure',
    signal: 'SIGTERM',
  }))
  const handle = await startProcess({
    stepId: 'failed-timeout',
    runId: 'failed-timeout-run',
    command: resolveNode(),
    args: [fileURLToPath(new URL('./long-running.mjs', import.meta.url))],
    timeout: 50,
    cancellationGraceMs: 25,
  })
  try {
    const error = await handle.result.then(
      () => null,
      resultError => resultError,
    )
    return {
      error: error && { code: error.code, message: error.message },
      aliveAfterFailure: handle.pid !== null && isAlive(handle.pid),
    }
  } finally {
    setProcessTerminationHookForTests(null)
    await forceKill(handle.pid)
  }
}

async function spawnErrorProof(): Promise<object> {
  try {
    await startProcess({
      stepId: 'spawn-error-step',
      runId: 'run-spawn-error',
      command: 'nonexistent_command_xyz',
    })
    return { unexpectedSuccess: true }
  } catch (error) {
    return {
      code: (error as { code?: string }).code,
    }
  }
}

async function boundedCallbackProof(): Promise<object> {
  let outputCallbacks = 0
  let heartbeatCallbacks = 0
  const handle = await startProcess({
    stepId: 'bounded-output-step',
    runId: 'run-bounded-output',
    command: resolveNode(),
    args: [fileURLToPath(new URL('./write-heartbeat.mjs', import.meta.url)), '40', '5'],
    maxOutputBytes: 96,
    callbackThrottleMs: 100,
    heartbeatIntervalMs: 20,
    onOutput: () => { outputCallbacks += 1 },
    onHeartbeat: () => { heartbeatCallbacks += 1 },
  })
  const result = await handle.result
  return {
    status: result.status,
    outputBytes: Buffer.byteLength(result.stdout),
    outputCallbacks,
    heartbeatCallbacks,
  }
}

async function serializedCallbackProof(): Promise<object> {
  let activeCallbacks = 0
  let maxActiveCallbacks = 0
  let completedCallbacks = 0
  const callback = async (): Promise<void> => {
    activeCallbacks += 1
    maxActiveCallbacks = Math.max(maxActiveCallbacks, activeCallbacks)
    await new Promise(resolveDelay => setTimeout(resolveDelay, 15))
    completedCallbacks += 1
    activeCallbacks -= 1
  }
  const handle = await startProcess({
    stepId: 'serialized-callback-step',
    runId: 'run-serialized-callback',
    command: resolveNode(),
    args: [fileURLToPath(new URL('./write-heartbeat.mjs', import.meta.url)), '20', '5'],
    callbackThrottleMs: 10,
    heartbeatIntervalMs: 10,
    onOutput: callback,
    onHeartbeat: callback,
  })
  const result = await handle.result
  return {
    status: result.status,
    maxActiveCallbacks,
    completedCallbacks,
    activeCallbacks,
  }
}

async function failedCallbackProof(): Promise<object> {
  const handle = await startProcess({
    stepId: 'failed-callback-step',
    runId: 'run-failed-callback',
    command: resolveNode(),
    args: [fileURLToPath(new URL('./exit-with-code.mjs', import.meta.url)), '0', '32'],
    onOutput: async () => {
      await Promise.resolve()
      throw new Error('persist output failed')
    },
  })
  const error = await handle.result.then(
    () => null,
    resultError => resultError,
  )
  return {
    code: error?.code,
    message: error?.message,
    status: error?.result?.status,
    exitCode: error?.result?.exitCode,
  }
}

async function nonzeroExitProof(): Promise<object> {
  const handle = await startProcess({
    stepId: 'exit-code-step',
    runId: 'run-exit-code',
    command: resolveNode(),
    args: [fileURLToPath(new URL('./exit-with-code.mjs', import.meta.url)), '17', '0'],
  })
  const result = await handle.result
  return {
    status: result.status,
    exitCode: result.exitCode,
  }
}

async function naturalExitBeforeCancelProof(): Promise<object> {
  const handle = await startProcess({
    stepId: 'natural-exit-before-cancel',
    runId: 'natural-exit-before-cancel-run',
    command: resolveNode(),
    args: ['-e', 'setTimeout(() => process.exit(17), 100)'],
  })
  if (handle.pid === null) throw new Error('Natural-exit fixture did not expose a PID')

  const deadline = Date.now() + 5_000
  while (isAlive(handle.pid) && Date.now() < deadline) {
    // Deliberately keep the Bun event loop blocked so the process can die before
    // the ChildProcess close callback runs. This exercises the cancel/death race.
  }
  if (isAlive(handle.pid)) throw new Error('Natural-exit fixture remained alive')

  const control = await handle.cancel()
  const result = await handle.result
  return {
    control,
    status: result.status,
    exitCode: result.exitCode,
  }
}

const mode = process.argv[2]
if (mode === 'cancel') {
  console.log(JSON.stringify(await cancelProof()))
} else if (mode === 'timeout') {
  console.log(JSON.stringify(await timeoutProof()))
} else if (mode === 'single-cancel') {
  console.log(JSON.stringify(await singleCancelProof()))
} else if (mode === 'single-timeout') {
  console.log(JSON.stringify(await singleTimeoutProof()))
} else if (mode === 'failed-cancel') {
  console.log(JSON.stringify(await failedCancelProof()))
} else if (mode === 'failed-taskkill') {
  console.log(JSON.stringify(await failedTaskkillProof()))
} else if (mode === 'timed-out-taskkill') {
  console.log(JSON.stringify(await timedOutTaskkillProof()))
} else if (mode === 'death-before-escalation-signal') {
  console.log(JSON.stringify(await deathBeforeEscalationSignalProof()))
} else if (mode === 'failed-timeout') {
  console.log(JSON.stringify(await failedTimeoutProof()))
} else if (mode === 'spawn-error') {
  console.log(JSON.stringify(await spawnErrorProof()))
} else if (mode === 'callback-bounded') {
  console.log(JSON.stringify(await boundedCallbackProof()))
} else if (mode === 'callback-serialized') {
  console.log(JSON.stringify(await serializedCallbackProof()))
} else if (mode === 'callback-failed') {
  console.log(JSON.stringify(await failedCallbackProof()))
} else if (mode === 'nonzero-exit') {
  console.log(JSON.stringify(await nonzeroExitProof()))
} else if (mode === 'natural-exit-before-cancel') {
  console.log(JSON.stringify(await naturalExitBeforeCancelProof()))
} else {
  throw new Error(`Unknown process proof mode: ${mode ?? '<missing>'}`)
}

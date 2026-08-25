import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

const bunExecutable = process.argv[2]
if (!bunExecutable) throw new Error('Bun executable argument is required')

const workerPath = fileURLToPath(new URL('./verify-tree-control.ts', import.meta.url))
// Windows control can consume two independently bounded taskkill attempts plus
// death observation. Leave scheduling headroom when the repository suite is busy.
const WORKER_TIMEOUT_MS = 60_000
const MAX_DIAGNOSTIC_BYTES = 1024 * 1024
const defaultModes = [
  'cancel',
  'timeout',
  'single-cancel',
  'single-timeout',
  'failed-cancel',
  'failed-taskkill',
  'timed-out-taskkill',
  'death-before-escalation-signal',
  'failed-timeout',
  'spawn-error',
  'callback-bounded',
  'callback-serialized',
  'callback-failed',
  'nonzero-exit',
  'natural-exit-before-cancel',
]
const requestedModes = process.argv.slice(3)
const modes = requestedModes.length > 0 ? requestedModes : defaultModes
for (const mode of modes) {
  if (!defaultModes.includes(mode)) throw new Error(`Unknown process proof mode: ${mode}`)
}

let activeWorker = null

async function terminateTree(child) {
  if (child.pid === undefined || child.exitCode !== null) return
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot ?? process.env.windir
    if (!systemRoot || !win32.isAbsolute(systemRoot)) {
      child.kill('SIGKILL')
      return
    }
    const command = win32.join(win32.resolve(systemRoot), 'System32', 'taskkill.exe')
    await access(command)
    await new Promise(resolve => {
      const killer = spawn(command, ['/PID', String(child.pid), '/T', '/F'], {
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
      })
      const timer = setTimeout(() => {
        killer.kill('SIGKILL')
        resolve()
      }, 5_000)
      killer.once('error', () => {
        clearTimeout(timer)
        resolve()
      })
      killer.once('close', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    return
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}

function appendBounded(current, chunk) {
  if (current.length >= MAX_DIAGNOSTIC_BYTES) return current
  return current + chunk.toString().slice(0, MAX_DIAGNOSTIC_BYTES - current.length)
}

async function runWorker(mode) {
  const child = spawn(bunExecutable, [workerPath, mode], {
    detached: process.platform !== 'win32',
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  activeWorker = child
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => {
    stdout = appendBounded(stdout, chunk)
  })
  child.stderr.on('data', chunk => {
    stderr = appendBounded(stderr, chunk)
  })

  return new Promise((resolve, reject) => {
    let settled = false
    let timedOut = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (activeWorker === child) activeWorker = null
      if (error) reject(error)
      else resolve(value)
    }
    const timer = setTimeout(() => {
      timedOut = true
      void terminateTree(child).then(
        () => finish(new Error(`tree proof ${mode} timed out after ${WORKER_TIMEOUT_MS}ms${stderr ? `: ${stderr}` : ''}`)),
        error => finish(new Error(`tree proof ${mode} timed out and cleanup failed: ${error.message}`)),
      )
    }, WORKER_TIMEOUT_MS)

    child.once('error', error => {
      void terminateTree(child).finally(() => {
        finish(new Error(`tree proof ${mode} failed to spawn: ${error.message}`))
      })
    })
    child.once('close', code => {
      if (timedOut) return
      if (code !== 0) {
        finish(new Error(stderr || `tree proof ${mode} exited ${code}`))
        return
      }
      try {
        finish(null, JSON.parse(stdout.trim()))
      } catch (error) {
        finish(new Error(`tree proof ${mode} returned invalid JSON: ${error.message}; stdout=${stdout}; stderr=${stderr}`))
      }
    })
  })
}

process.once('SIGTERM', () => {
  void (async () => {
    if (activeWorker) await terminateTree(activeWorker)
    process.exit(143)
  })()
})

const results = {}
for (const mode of modes) {
  const key = mode.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
  results[key] = await runWorker(mode)
}

console.log(JSON.stringify(results))

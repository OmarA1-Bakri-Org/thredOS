import { existsSync } from 'fs'
import { createServer } from 'net'
import { delimiter, posix, win32 } from 'path'
import { spawnSync } from 'child_process'

function pathApi(platform) {
  return platform === 'win32' ? win32 : posix
}

function bunExecutableName(platform) {
  return platform === 'win32' ? 'bun.exe' : 'bun'
}

function lookupBunCandidates(platform) {
  const result = platform === 'win32'
    ? spawnSync('where.exe', ['bun'], { encoding: 'utf8', windowsHide: true })
    : spawnSync('sh', ['-lc', 'command -v bun'], { encoding: 'utf8' })

  if (result.error || result.status !== 0) return []
  return result.stdout
    .split(/\r?\n/)
    .map(candidate => candidate.trim())
    .filter(Boolean)
}

export function findBunPath({
  env = process.env,
  platform = process.platform,
  exists = existsSync,
  lookup = () => lookupBunCandidates(platform),
} = {}) {
  const paths = pathApi(platform)
  const executable = bunExecutableName(platform)
  const candidates = []

  if (env.BUN_BIN) candidates.push(env.BUN_BIN)
  if (env.BUN_INSTALL) candidates.push(paths.join(env.BUN_INSTALL, 'bin', executable))

  const home = platform === 'win32' ? env.USERPROFILE ?? env.HOME : env.HOME
  if (home) candidates.push(paths.join(home, '.bun', 'bin', executable))

  const lookedUp = lookup()
  candidates.push(...(Array.isArray(lookedUp) ? lookedUp : [lookedUp]))

  return candidates.find(candidate => typeof candidate === 'string' && candidate.length > 0 && exists(candidate)) ?? null
}

export function prependPath(directory, currentPath, platform = process.platform) {
  const separator = platform === process.platform ? delimiter : platform === 'win32' ? ';' : ':'
  return [directory, currentPath].filter(value => typeof value === 'string' && value.length > 0).join(separator)
}

export function prependEnvironmentPath(env, directory, platform = process.platform) {
  const existingKey = Object.keys(env).find(key => key.toLowerCase() === 'path')
  const pathKey = existingKey ?? 'PATH'
  const pathValue = prependPath(directory, env[pathKey], platform)
  return {
    ...env,
    ...(pathValue ? { [pathKey]: pathValue } : {}),
  }
}

export function buildRelayVerificationArgs(mode, playwrightArgs = []) {
  return ['scripts/verify/run.mjs', mode, ...playwrightArgs]
}

export function defaultVerificationPort(mode) {
  if (mode === 'local') return 4301
  if (mode === 'ci') return 4302
  if (mode === 'ui') return 4303
  return null
}

export function localVerificationBaseURL(port) {
  // Playwright's API cookie jar recognizes localhost for Secure loopback cookies.
  return `http://localhost:${port}`
}

async function claimPort(port) {
  return await new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', error => {
      if (error?.code === 'EADDRINUSE' || error?.code === 'EACCES') {
        resolve(null)
        return
      }
      reject(error)
    })
    server.listen({ host: '127.0.0.1', port }, () => {
      const address = server.address()
      resolve({
        reservation: server,
        port: typeof address === 'object' && address ? address.port : null,
      })
    })
  })
}

export async function reserveVerificationPort(mode, explicitPort) {
  if (mode === 'release-live') return { port: null, reservation: null }

  const requestedPort = explicitPort === undefined ? defaultVerificationPort(mode) : Number(explicitPort)
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
    throw new Error(`Invalid verification port: ${explicitPort}`)
  }

  const requested = await claimPort(requestedPort)
  if (requested) return requested
  if (explicitPort !== undefined) throw new Error(`Verification port ${requestedPort} is unavailable`)

  const fallback = await claimPort(0)
  if (!fallback?.port) throw new Error('Failed to allocate a verification port')
  return fallback
}

export async function releasePortReservation(reservation) {
  if (!reservation?.listening) return
  await new Promise((resolve, reject) => {
    reservation.close(error => error ? reject(error) : resolve())
  })
}

function resolveBunBinDirectory(env, platform) {
  const paths = pathApi(platform)
  if (env.BUN_INSTALL) return paths.join(env.BUN_INSTALL, 'bin')
  if (env.BUN_BIN) return paths.dirname(env.BUN_BIN)
  return undefined
}

export function createPlaywrightServerSettings({
  mode,
  env = process.env,
  platform = process.platform,
}) {
  const defaultPort = defaultVerificationPort(mode)
  const port = env.PLAYWRIGHT_PORT ?? (defaultPort == null ? undefined : String(defaultPort))
  const baseURL = env.PLAYWRIGHT_BASE_URL
    ?? (port ? localVerificationBaseURL(port) : undefined)
  const serverEnv = {
    ...prependEnvironmentPath(env, resolveBunBinDirectory(env, platform), platform),
    ...(platform === 'win32' ? { SystemRoot: env.SystemRoot ?? 'C:\\Windows' } : {}),
  }

  return { port, baseURL, env: serverEnv }
}

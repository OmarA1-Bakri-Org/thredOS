#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { spawnSync } from 'child_process'
import { tmpdir } from 'os'
import { createServer } from 'net'

const mode = process.argv[2]
const root = process.cwd()

if (!['local', 'ci', 'release-live'].includes(mode ?? '')) {
  console.error('Usage: node scripts/verify/run.mjs <local|ci|release-live>')
  process.exit(1)
}

function parseEnvFile(filePath) {
  const env = {}
  const content = readFileSync(filePath, 'utf8')
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const equalsIndex = line.indexOf('=')
    if (equalsIndex === -1) continue
    const key = line.slice(0, equalsIndex).trim()
    const value = line.slice(equalsIndex + 1).trim()
    env[key] = value
  }
  return env
}

function applyDefaults(target, values) {
  for (const [key, value] of Object.entries(values)) {
    if (target[key] === undefined) {
      target[key] = value
    }
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function isUnsupportedMountPath(pathname) {
  return process.platform === 'linux' && resolve(pathname).startsWith('/mnt/')
}

function resolveNativeLinuxTmpRoot() {
  const resolvedTmp = resolve(tmpdir())
  if (process.platform === 'linux' && resolvedTmp.startsWith('/mnt/')) {
    return '/tmp'
  }
  return resolvedTmp
}

function getFailureMessage(result, label) {
  if (result.error) {
    return result.error.message
  }

  if (result.signal) {
    return `${label} terminated by signal ${result.signal}`
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    return `${label} exited with code ${result.status}`
  }

  return null
}

function makeTempVerifyDir() {
  const prefix = join(resolveNativeLinuxTmpRoot(), 'threados-verify-')
  const result = spawnSync('mktemp', ['-d', `${prefix}XXXXXX`], { encoding: 'utf8' })
  const failure = getFailureMessage(result, 'mktemp')
  if (failure) {
    throw new Error(`Failed to create native temp directory for verification relay: ${failure}`)
  }

  const tempDir = result.stdout.trim()
  if (!tempDir) {
    throw new Error('Failed to create native temp directory for verification relay: mktemp returned an empty path')
  }

  return tempDir
}

function syncRepoToTemp(sourceRoot, tempRoot) {
  const source = sourceRoot.endsWith('/') ? sourceRoot : `${sourceRoot}/`
  const destination = tempRoot.endsWith('/') ? tempRoot : `${tempRoot}/`
  const result = spawnSync('rsync', [
    '-a',
    '--delete',
    '--exclude=.git',
    '--exclude=.omx',
    '--exclude=.next',
    '--exclude=test-results',
    '--exclude=playwright-report',
    '--exclude=dist-desktop',
    '--exclude=.eslintcache',
    '--exclude=node_modules',
    source,
    destination,
  ], {
    stdio: 'inherit',
  })

  const failure = getFailureMessage(result, 'rsync')
  if (failure) {
    throw new Error(`Failed to copy verification workspace into native temp directory: ${failure}`)
  }
}

function installTempDependencies(tempRoot, bunPath) {
  const result = spawnSync(bunPath, ['install', '--frozen-lockfile'], {
    cwd: tempRoot,
    stdio: 'inherit',
  })

  const failure = getFailureMessage(result, 'bun install --frozen-lockfile')
  if (failure) {
    throw new Error(`Failed to install dependencies in native temp verification workspace: ${failure}`)
  }
}

function syncVerifyArtifactsBack(tempRoot, sourceRoot) {
  const sourceVerifyDir = join(tempRoot, 'test-results', 'verify')
  if (!existsSync(sourceVerifyDir)) return

  const destinationVerifyDir = join(sourceRoot, 'test-results', 'verify')
  mkdirSync(destinationVerifyDir, { recursive: true })

  const result = spawnSync('rsync', [
    '-a',
    `${sourceVerifyDir}/`,
    `${destinationVerifyDir}/`,
  ], {
    stdio: 'inherit',
  })

  const failure = getFailureMessage(result, 'rsync')
  if (failure) {
    throw new Error(`Failed to sync verification artifacts back to the original workspace: ${failure}`)
  }
}

function relayVerificationThroughNativeTemp(modeName, sourceRoot, bunPath) {
  const tempRoot = makeTempVerifyDir()

  console.warn(`[verify:${modeName}] relaying through native Linux temp copy because ${sourceRoot} is on /mnt/*`)
  console.warn(`[verify:${modeName}] temp workspace: ${tempRoot}`)

  let exitCode = 1
  try {
    syncRepoToTemp(sourceRoot, tempRoot)
    installTempDependencies(tempRoot, bunPath)

    const result = spawnSync(process.execPath, ['scripts/verify/run.mjs', modeName], {
      cwd: tempRoot,
      env: {
        ...process.env,
        THREDOS_VERIFY_NATIVE_RELAY: '1',
      },
      stdio: 'inherit',
    })

    syncVerifyArtifactsBack(tempRoot, sourceRoot)

    const failure = getFailureMessage(result, `node scripts/verify/run.mjs ${modeName}`)
    if (failure) {
      throw new Error(`Native temp verification relay failed: ${failure}`)
    }

    exitCode = result.status ?? 0
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }

  return exitCode
}

function ensureBinary(description, binaryPath) {
  if (!existsSync(binaryPath)) {
    throw new Error(`${description} not found at ${binaryPath}`)
  }
}

async function claimPort(port) {
  return await new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', error => {
      if (error && error.code !== 'EADDRINUSE' && error.code !== 'EACCES') {
        reject(error)
        return
      }
      resolve(null)
    })
    server.listen({ host: '127.0.0.1', port }, () => {
      const address = server.address()
      const claimed = typeof address === 'object' && address ? address.port : null
      resolve({ server, port: claimed })
    })
  })
}

async function resolvePlaywrightPort(modeName, explicitPort) {
  if (explicitPort) return { server: null, port: explicitPort }

  const preferredPort = modeName === 'local' ? 4301 : modeName === 'ci' ? 4302 : 4303
  const preferredClaim = await claimPort(preferredPort)
  if (preferredClaim && preferredClaim.port) {
    return { server: preferredClaim.server, port: String(preferredClaim.port) }
  }

  const fallbackClaim = await claimPort(0)
  if (!fallbackClaim || !fallbackClaim.port) {
    throw new Error('Failed to allocate a verification port')
  }

  console.warn(`[verify:${modeName}] port ${preferredPort} is busy; using ephemeral port ${fallbackClaim.port} instead`)
  return { server: fallbackClaim.server, port: String(fallbackClaim.port) }
}

function findBunPath() {
  const explicit = process.env.BUN_BIN
  if (explicit && existsSync(explicit)) {
    return explicit
  }

  const home = process.env.HOME
  const bundled = home ? join(home, '.bun', 'bin', 'bun') : null
  if (bundled && existsSync(bundled)) {
    return bundled
  }

  const fromPath = spawnSync('bash', ['-lc', 'command -v bun'], { encoding: 'utf8' })
  if (fromPath.status === 0) {
    const resolvedPath = fromPath.stdout.trim()
    if (resolvedPath) return resolvedPath
  }

  return null
}

const REQUIRED_BROWSER_LIBS = ['libnspr4.so', 'libnss3.so', 'libnssutil3.so', 'libasound.so.2']

function resolveVendoredBrowserLibPaths() {
  const explicit = process.env.PLAYWRIGHT_BROWSER_LIB_DIR
  const home = process.env.HOME
  return [
    explicit ?? null,
    home ? join(home, '.cache', 'thredos', 'pwlibs', 'root', 'usr', 'lib', 'x86_64-linux-gnu') : null,
    '/tmp/pwlibs/root/usr/lib/x86_64-linux-gnu',
  ].filter(Boolean)
}

function hasVendoredBrowserLibs(dir) {
  return REQUIRED_BROWSER_LIBS.every(fileName => existsSync(join(dir, fileName)))
}

function resolveBrowserLibDir() {
  return resolveVendoredBrowserLibPaths().find(dir => hasVendoredBrowserLibs(dir)) ?? null
}

function resolveAlsaPackageName() {
  const candidate = spawnSync('apt-cache', ['show', 'libasound2t64'], { encoding: 'utf8' })
  return candidate.status === 0 ? 'libasound2t64' : 'libasound2'
}

function bootstrapVendoredBrowserLibraries() {
  const home = process.env.HOME
  if (!home) return null

  const cacheRoot = join(home, '.cache', 'thredos', 'pwlibs')
  const debDir = join(cacheRoot, 'debs')
  const rootDir = join(cacheRoot, 'root')
  const libDir = join(rootDir, 'usr', 'lib', 'x86_64-linux-gnu')

  if (hasVendoredBrowserLibs(libDir)) {
    return libDir
  }

  mkdirSync(debDir, { recursive: true })
  mkdirSync(rootDir, { recursive: true })

  const packages = ['libnss3', 'libnspr4', resolveAlsaPackageName()]
  const download = spawnSync('apt', ['download', ...packages], {
    cwd: debDir,
    encoding: 'utf8',
  })
  if (download.status !== 0) {
    return null
  }

  const debFiles = readdirSync(debDir)
    .filter(fileName => fileName.endsWith('.deb'))
    .map(fileName => join(debDir, fileName))

  for (const debFile of debFiles) {
    const extract = spawnSync('dpkg-deb', ['-x', debFile, rootDir], { encoding: 'utf8' })
    if (extract.status !== 0) {
      return null
    }
  }

  return hasVendoredBrowserLibs(libDir) ? libDir : null
}

function hasSystemBrowserLibs() {
  const check = spawnSync('bash', ['-lc', 'ldconfig -p | grep -E "libnspr4\\.so|libnss3\\.so|libnssutil3\\.so|libasound\\.so\\.2"'], {
    encoding: 'utf8',
  })
  return check.status === 0
}

function ensureBrowserLibraries() {
  if (process.platform !== 'linux') return { ldLibraryPath: null }

  const vendorDir = resolveBrowserLibDir() ?? bootstrapVendoredBrowserLibraries()
  if (vendorDir) {
    return { ldLibraryPath: vendorDir }
  }

  if (hasSystemBrowserLibs()) {
    return { ldLibraryPath: null }
  }

  throw new Error('Browser shared libraries are missing. Install Playwright dependencies or provide /tmp/pwlibs/root/usr/lib/x86_64-linux-gnu')
}

function prepareWorkspace(artifactsDir) {
  const fixturePath = join(root, 'test', 'fixtures', 'verification-workspace')
  if (!existsSync(fixturePath)) {
    throw new Error(`Verification fixture workspace is missing at ${fixturePath}`)
  }

  const workspacePath = join(artifactsDir, 'workspace')
  cpSync(fixturePath, workspacePath, { recursive: true })

  const workspaceStatePath = join(workspacePath, '.threados', 'state', 'local-workspace.json')
  if (existsSync(workspaceStatePath)) {
    const state = JSON.parse(readFileSync(workspaceStatePath, 'utf8'))
    writeFileSync(workspaceStatePath, `${JSON.stringify({
      ...state,
      basePath: workspacePath,
      lastOpenedAt: new Date().toISOString(),
    }, null, 2)}\n`, 'utf8')
  }

  return workspacePath
}

function getSpecStatus(spec) {
  const resultStatuses = (spec.tests ?? []).flatMap(test => (test.results ?? []).map(result => result.status ?? 'unknown'))

  if (resultStatuses.some(status => status === 'failed' || status === 'timedOut' || status === 'interrupted')) {
    return 'failed'
  }

  if (resultStatuses.some(status => status === 'flaky')) {
    return 'flaky'
  }

  if (resultStatuses.length > 0 && resultStatuses.every(status => status === 'skipped')) {
    return 'skipped'
  }

  if (spec.ok === false) {
    return 'failed'
  }

  return 'passed'
}

function collectSuiteEntries(suites, file = null, entries = []) {
  for (const suite of suites ?? []) {
    const nextFile = suite.file ?? file
    for (const spec of suite.specs ?? []) {
      const tests = spec.tests ?? []
      const status = getSpecStatus(spec)
      entries.push({
        file: nextFile,
        title: [...(suite.title ? [suite.title] : []), spec.title].join(' › '),
        status,
        durationMs: tests.reduce((total, test) => total + (test.results?.reduce((sum, result) => sum + (result.duration ?? 0), 0) ?? 0), 0),
      })
    }
    collectSuiteEntries(suite.suites, nextFile, entries)
  }
  return entries
}

function readLogTail(filePath, maxChars = 4000) {
  if (!filePath || !existsSync(filePath)) return null
  const content = readFileSync(filePath, 'utf8')
  return content.length <= maxChars ? content : content.slice(content.length - maxChars)
}

function classifyStartupFailure(env, summary, rawReport, suites) {
  if (!rawReport || suites.length > 0 || (summary?.unexpected ?? 0) === 0) {
    return null
  }

  const buildLogTail = readLogTail(env.PLAYWRIGHT_BUILD_LOG_PATH)
  const serverLogTail = readLogTail(env.PLAYWRIGHT_SERVER_LOG_PATH)
  const combined = [buildLogTail, serverLogTail].filter(Boolean).join('\n')
  if (!combined.trim()) return null

  const failureLine = combined
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .reverse()
    .find(line =>
      line.includes('failed:') ||
      line.includes('exited with signal') ||
      line.includes('exited with code'),
    ) ?? 'Verification startup failed before any browser suite could run.'

  return {
    phase: 'startup',
    boundary: 'UI',
    message: failureLine,
    buildLogTail,
    serverLogTail,
  }
}

function writeManifest(env, artifactsDir, modeName, workspacePath, exitStatus) {
  const reportPath = env.PLAYWRIGHT_JSON_REPORT_PATH
  const manifestPath = env.PLAYWRIGHT_RUN_MANIFEST_PATH
  const rawReport = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null
  const suites = rawReport ? collectSuiteEntries(rawReport.suites ?? []) : []
  const summary = rawReport?.stats
    ? {
        expected: rawReport.stats.expected ?? 0,
        skipped: rawReport.stats.skipped ?? 0,
        unexpected: rawReport.stats.unexpected ?? 0,
        flaky: rawReport.stats.flaky ?? 0,
        durationMs: rawReport.stats.duration ?? 0,
      }
    : {
        expected: 0,
        skipped: 0,
        unexpected: exitStatus === 0 ? 0 : 1,
        flaky: 0,
        durationMs: 0,
      }
  const startupFailure = classifyStartupFailure(env, summary, rawReport, suites)

  const manifest = {
    generatedAt: new Date().toISOString(),
    mode: modeName,
    baseUrl: env.PLAYWRIGHT_BASE_URL,
    workspacePath,
    artifactsDir,
    serverLogPath: env.PLAYWRIGHT_SERVER_LOG_PATH ?? null,
    buildLogPath: env.PLAYWRIGHT_BUILD_LOG_PATH ?? null,
    readinessPath: join(artifactsDir, 'readiness.json'),
    suites,
    summary,
    startupFailure,
  }

  mkdirSync(dirname(manifestPath), { recursive: true })
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

try {
  const env = {
    ...process.env,
  }

  const envFile = mode === 'local'
    ? join(root, '.env.verify.local')
    : mode === 'ci'
      ? join(root, '.env.verify.ci')
      : null

  if (envFile) {
    applyDefaults(env, parseEnvFile(envFile))
  }

  ensureBinary('Playwright CLI', join(root, 'node_modules', 'playwright', 'cli.js'))
  ensureBinary('Next.js CLI', join(root, 'node_modules', 'next', 'dist', 'bin', 'next'))

  const bunPath = findBunPath()
  if (!bunPath) {
    throw new Error('Bun is required for verification bootstrap but was not found on PATH or at ~/.bun/bin/bun')
  }

  if ((mode === 'local' || mode === 'ci') && isUnsupportedMountPath(root) && process.env.THREDOS_VERIFY_NATIVE_RELAY !== '1') {
    process.exit(relayVerificationThroughNativeTemp(mode, root, bunPath))
  }

  const artifactsDir = join(root, 'test-results', 'verify', mode, timestamp())
  mkdirSync(artifactsDir, { recursive: true })

  const browserLibraries = ensureBrowserLibraries()
  env.PATH = [dirname(bunPath), env.PATH].filter(Boolean).join(':')
  if (browserLibraries.ldLibraryPath) {
    env.LD_LIBRARY_PATH = [browserLibraries.ldLibraryPath, env.LD_LIBRARY_PATH].filter(Boolean).join(':')
  }

  env.PLAYWRIGHT_ARTIFACTS_DIR = artifactsDir
  env.PLAYWRIGHT_JSON_REPORT_PATH = join(artifactsDir, 'playwright-report.json')
  env.PLAYWRIGHT_RUN_MANIFEST_PATH = join(artifactsDir, 'run-manifest.json')
  env.PLAYWRIGHT_SERVER_LOG_PATH = join(artifactsDir, 'server.log')
  env.PLAYWRIGHT_BUILD_LOG_PATH = join(artifactsDir, 'build.log')
  const portAllocation = await resolvePlaywrightPort(mode, env.PLAYWRIGHT_PORT)
  env.PLAYWRIGHT_PORT = portAllocation.port
  const claimedServer = portAllocation.server

  let workspacePath = null
  if (mode === 'release-live') {
    const baseUrl = env.THREDOS_VERIFY_BASE_URL ?? env.PLAYWRIGHT_BASE_URL
    if (!baseUrl) {
      throw new Error('verify:release-live requires THREDOS_VERIFY_BASE_URL')
    }
    env.PLAYWRIGHT_BASE_URL = baseUrl
  } else {
    workspacePath = prepareWorkspace(artifactsDir)
    env.THREDOS_BASE_PATH = workspacePath
    env.THREADOS_BASE_PATH = workspacePath
    env.PLAYWRIGHT_BASE_URL = `http://localhost:${env.PLAYWRIGHT_PORT}`
  }

  writeFileSync(join(artifactsDir, 'metadata.json'), `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    mode,
    workspacePath,
    baseUrl: env.PLAYWRIGHT_BASE_URL,
    bunPath,
  }, null, 2)}\n`, 'utf8')

  const configPath = mode === 'local'
    ? 'playwright.dev-verify.config.ts'
    : mode === 'ci'
      ? 'playwright.config.ts'
      : 'playwright.release-live.config.ts'

  console.log(`[verify:${mode}] artifacts: ${artifactsDir}`)
  console.log(`[verify:${mode}] config: ${configPath}`)
  if (workspacePath) {
    console.log(`[verify:${mode}] workspace: ${workspacePath}`)
  }

  const result = spawnSync(process.execPath, [
    'node_modules/playwright/cli.js',
    'test',
    '--config',
    configPath,
  ], {
    cwd: root,
    env,
    stdio: 'inherit',
  })

  writeManifest(env, artifactsDir, mode, workspacePath, result.status ?? 1)

  if (claimedServer) {
    claimedServer.close()
  }

  if (result.error) {
    throw result.error
  }

  process.exit(result.status ?? 1)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
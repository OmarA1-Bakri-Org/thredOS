#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { spawnSync } from 'child_process'

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
  return resolve(pathname).startsWith('/mnt/')
}

function ensureBinary(description, binaryPath) {
  if (!existsSync(binaryPath)) {
    throw new Error(`${description} not found at ${binaryPath}`)
  }
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

function resolveBrowserLibDir() {
  const vendorDir = '/tmp/pwlibs/root/usr/lib/x86_64-linux-gnu'
  return existsSync(vendorDir) ? vendorDir : null
}

function hasSystemBrowserLibs() {
  const check = spawnSync('bash', ['-lc', 'ldconfig -p | grep -E "libnspr4\\.so|libnss3\\.so|libnssutil3\\.so|libasound\\.so\\.2"'], {
    encoding: 'utf8',
  })
  return check.status === 0
}

function ensureBrowserLibraries() {
  if (process.platform !== 'linux') return { ldLibraryPath: null }

  const vendorDir = resolveBrowserLibDir()
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

function collectSuiteEntries(suites, file = null, entries = []) {
  for (const suite of suites ?? []) {
    const nextFile = suite.file ?? file
    for (const spec of suite.specs ?? []) {
      const tests = spec.tests ?? []
      const outcomes = tests.map(test => test.outcome ?? 'unknown')
      const status = outcomes.some(outcome => outcome === 'unexpected')
        ? 'failed'
        : outcomes.some(outcome => outcome === 'flaky')
          ? 'flaky'
          : outcomes.some(outcome => outcome === 'skipped')
            ? 'skipped'
            : 'passed'
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

function classifyStartupFailure(env, summary) {
  if (summary?.unexpected === 0) return null

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
  const startupFailure = classifyStartupFailure(env, summary)

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
  const artifactsDir = join(root, 'test-results', 'verify', mode, timestamp())
  mkdirSync(artifactsDir, { recursive: true })

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

  if (mode === 'local' && isUnsupportedMountPath(root)) {
    console.error('verify:local is unsupported from /mnt/* mounts. Run it from a native Linux filesystem copy of the repo.')
    process.exit(1)
  }

  if (mode === 'ci' && isUnsupportedMountPath(root)) {
    console.error('verify:ci is unsupported from /mnt/* mounts. Run it from a native Linux filesystem copy of the repo or a Linux CI runner.')
    process.exit(1)
  }

  ensureBinary('Playwright CLI', join(root, 'node_modules', 'playwright', 'cli.js'))
  ensureBinary('Next.js CLI', join(root, 'node_modules', 'next', 'dist', 'bin', 'next'))

  const bunPath = findBunPath()
  if (!bunPath) {
    throw new Error('Bun is required for verification bootstrap but was not found on PATH or at ~/.bun/bin/bun')
  }

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
  env.PLAYWRIGHT_PORT = env.PLAYWRIGHT_PORT ?? (mode === 'local' ? '4301' : mode === 'ci' ? '4302' : '4303')

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
    env.PLAYWRIGHT_BASE_URL = `http://127.0.0.1:${env.PLAYWRIGHT_PORT}`
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

  if (result.error) {
    throw result.error
  }

  process.exit(result.status ?? 1)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

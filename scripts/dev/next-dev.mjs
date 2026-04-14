#!/usr/bin/env node

import { existsSync, mkdtempSync, rmSync } from 'fs'
import { cpSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { spawn, spawnSync } from 'child_process'

const root = process.cwd()
const host = process.env.THREDOS_DEV_HOST ?? '0.0.0.0'
const port = process.env.PORT ?? '3000'

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

function makeTempDir() {
  const prefix = join(resolveNativeLinuxTmpRoot(), 'thredos-dev-')
  const result = spawnSync('mktemp', ['-d', `${prefix}XXXXXX`], { encoding: 'utf8' })
  if (result.status === 0 && result.stdout.trim()) {
    return result.stdout.trim()
  }
  return mkdtempSync(prefix)
}

function findBunPath() {
  const explicit = process.env.BUN_BIN
  if (explicit && existsSync(explicit)) return explicit

  const home = process.env.HOME
  const bundled = home ? join(home, '.bun', 'bin', 'bun') : null
  if (bundled && existsSync(bundled)) return bundled

  const fromPath = spawnSync('bash', ['-lc', 'command -v bun'], { encoding: 'utf8' })
  if (fromPath.status === 0) {
    const resolvedPath = fromPath.stdout.trim()
    if (resolvedPath) return resolvedPath
  }

  throw new Error('Bun is required for dev:wsl but was not found on PATH or at ~/.bun/bin/bun')
}

function syncWorkspaceToTemp(tempDir) {
  const rsyncResult = spawnSync('rsync', [
    '-a',
    '--delete',
    '--exclude=.git',
    '--exclude=.omx',
    '--exclude=.next',
    '--exclude=dist-desktop',
    '--exclude=node_modules',
    '--exclude=test-results',
    '--exclude=playwright-report',
    '--exclude=.eslintcache',
    `${root}/`,
    `${tempDir}/`,
  ], { stdio: 'inherit' })

  if (rsyncResult.error || (typeof rsyncResult.status === 'number' && rsyncResult.status !== 0)) {
    console.warn('[dev:wsl] rsync not available or failed, falling back to fs.cpSync')
    cpSync(root, tempDir, {
      recursive: true,
      filter: (src) => {
        const base = src.replace(root, '')
        return !base.startsWith('/.git')
          && !base.startsWith('/.omx')
          && !base.startsWith('/.next')
          && !base.startsWith('/dist-desktop')
          && !base.startsWith('/node_modules')
          && !base.startsWith('/test-results')
          && !base.startsWith('/playwright-report')
          && !base.startsWith('/.eslintcache')
      },
    })
  }
}

function installDependencies(tempDir) {
  const bunPath = findBunPath()
  const result = spawnSync(bunPath, ['install', '--frozen-lockfile'], {
    cwd: tempDir,
    stdio: 'inherit',
  })

  if (result.error) throw result.error
  if (result.signal || result.status !== 0) {
    throw new Error(`bun install failed with ${result.signal ? `signal ${result.signal}` : `code ${result.status ?? 1}`}`)
  }
}

function spawnNextDev(cwd, cleanup) {
  const child = spawn('node', ['./node_modules/next/dist/bin/next', 'dev', '--hostname', host, '--port', port], {
    cwd,
    env: process.env,
    stdio: 'inherit',
  })

  const forward = (signal) => {
    if (!child.killed) child.kill(signal)
  }

  process.on('SIGINT', () => forward('SIGINT'))
  process.on('SIGTERM', () => forward('SIGTERM'))

  child.on('exit', (code, signal) => {
    cleanup()
    if (signal) {
      process.exit(1)
    }
    process.exit(code ?? 0)
  })
}

if (!isUnsupportedMountPath(root)) {
  console.log(`[dev:wsl] launching directly from ${root}`)
  spawnNextDev(root, () => {})
} else {
  const tempDir = makeTempDir()
  console.warn(`[dev:wsl] relaying through native Linux temp copy because ${root} is on /mnt/*`)
  console.warn(`[dev:wsl] temp workspace: ${tempDir}`)
  console.warn(`[dev:wsl] server URL: http://localhost:${port}`)
  console.warn('[dev:wsl] source edits do not hot-reload into the temp workspace; restart this command after changing repo files.')

  try {
    syncWorkspaceToTemp(tempDir)
    installDependencies(tempDir)
    spawnNextDev(tempDir, () => rmSync(tempDir, { recursive: true, force: true }))
  } catch (error) {
    rmSync(tempDir, { recursive: true, force: true })
    throw error
  }
}

#!/usr/bin/env node

import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs'
import { cpSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { spawnSync } from 'child_process'

const root = process.cwd()

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

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  })

  if (result.error) {
    throw result.error
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status)
  }

  if (result.signal) {
    console.error(`[next-build] ${command} terminated by signal ${result.signal}`)
    process.exit(1)
  }
}

function makeTempBuildDir() {
  const prefix = join(resolveNativeLinuxTmpRoot(), 'threados-build-')
  const result = spawnSync('mktemp', ['-d', `${prefix}XXXXXX`], { encoding: 'utf8' })

  if (result.error || result.signal || (typeof result.status === 'number' && result.status !== 0)) {
    console.warn('[next-build] mktemp not available or failed, falling back to fs.mkdtempSync')
    return mkdtempSync(prefix)
  }

  return result.stdout.trim()
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
    `${root}/`,
    `${tempDir}/`,
  ], { stdio: 'inherit' })

  if (rsyncResult.error || (typeof rsyncResult.status === 'number' && rsyncResult.status !== 0)) {
    console.warn('[next-build] rsync not available or failed, falling back to fs.cpSync')
    cpSync(root, tempDir, {
      recursive: true,
      filter: (src) => {
        const base = src.replace(root, '')
        return !base.startsWith('/.git')
          && !base.startsWith('/.omx')
          && !base.startsWith('/.next')
          && !base.startsWith('/dist-desktop')
          && !base.startsWith('/node_modules')
      },
    })
  }
}

function installDependencies(tempDir) {
  const bunPath = findBunPath()
  if (!bunPath) {
    throw new Error('Bun is required for temp-copy builds but was not found on PATH or at ~/.bun/bin/bun')
  }
  run(bunPath, ['install', '--frozen-lockfile'], { cwd: tempDir })
}

function buildInTemp(tempDir) {
  run('node', ['./node_modules/next/dist/bin/next', 'build'], { cwd: tempDir })
}

function syncBuildOutputBack(tempDir) {
  const source = join(tempDir, '.next')
  const destination = join(root, '.next')

  if (!existsSync(source)) {
    console.error('[next-build] expected .next output in temp build directory, but none was produced')
    process.exit(1)
  }

  rmSync(destination, { recursive: true, force: true })
  mkdirSync(dirname(destination), { recursive: true })
  cpSync(source, destination, { recursive: true })
}

if (!isUnsupportedMountPath(root)) {
  run('node', ['./node_modules/next/dist/bin/next', 'build'], { cwd: root })
  process.exit(0)
}

const tempDir = makeTempBuildDir()
if (!tempDir) {
  console.error('[next-build] failed to create temp build directory')
  process.exit(1)
}

console.warn(`[next-build] building from native Linux temp copy because ${root} is on /mnt/*`)
console.warn(`[next-build] temp workspace: ${tempDir}`)

try {
  syncWorkspaceToTemp(tempDir)
  installDependencies(tempDir)
  buildInTemp(tempDir)
  syncBuildOutputBack(tempDir)
  console.warn('[next-build] build completed and .next synced back to the original workspace')
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}

#!/usr/bin/env node

import { existsSync, mkdirSync, rmSync } from 'fs'
import { cpSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { spawnSync } from 'child_process'

const root = process.cwd()

function isUnsupportedMountPath(pathname) {
  return resolve(pathname).startsWith('/mnt/')
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
  const prefix = join(tmpdir(), 'threados-build-')
  return spawnSync('mktemp', ['-d', `${prefix}XXXXXX`], { encoding: 'utf8' }).stdout.trim()
}

function syncWorkspaceToTemp(tempDir) {
  run('rsync', [
    '-a',
    '--delete',
    '--exclude=.git',
    '--exclude=.omx',
    '--exclude=.next',
    '--exclude=dist-desktop',
    '--exclude=node_modules',
    `${root}/`,
    `${tempDir}/`,
  ])
}

function installDependencies(tempDir) {
  run('bun', ['install', '--frozen-lockfile'], { cwd: tempDir })
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

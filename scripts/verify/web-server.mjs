#!/usr/bin/env node

import { createWriteStream, existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { spawn } from 'child_process'

const mode = process.argv[2]

if (!['local', 'ci'].includes(mode ?? '')) {
  console.error('Usage: node scripts/verify/web-server.mjs <local|ci>')
  process.exit(1)
}

const root = process.cwd()
const port = process.env.PLAYWRIGHT_PORT ?? (mode === 'local' ? '4301' : '4302')
const serverLogPath = process.env.PLAYWRIGHT_SERVER_LOG_PATH ?? join(root, 'test-results', 'verify', `${mode}-server.log`)
const buildLogPath = process.env.PLAYWRIGHT_BUILD_LOG_PATH ?? join(root, 'test-results', 'verify', `${mode}-build.log`)

mkdirSync(dirname(serverLogPath), { recursive: true })
mkdirSync(dirname(buildLogPath), { recursive: true })

const serverLog = createWriteStream(serverLogPath, { flags: 'a' })
const buildLog = createWriteStream(buildLogPath, { flags: 'a' })

function writeLine(stream, line) {
  stream.write(`${new Date().toISOString()} ${line}\n`)
}

function pipeOutput(child, stream, label) {
  child.stdout?.on('data', chunk => {
    stream.write(`[${label}:stdout] ${chunk}`)
  })
  child.stderr?.on('data', chunk => {
    stream.write(`[${label}:stderr] ${chunk}`)
  })
}

function spawnNext(args, stream, label) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  pipeOutput(child, stream, label)
  return child
}

async function waitForExit(child, label) {
  return await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve(undefined)
        return
      }
      reject(new Error(
        signal
          ? `${label} exited with signal ${signal}`
          : `${label} exited with code ${code ?? 1}`,
      ))
    })
  })
}

function attachSignalForwarding(child) {
  const forward = signal => {
    if (!child.killed) {
      child.kill(signal)
    }
  }

  process.on('SIGINT', () => forward('SIGINT'))
  process.on('SIGTERM', () => forward('SIGTERM'))
}

async function main() {
  writeLine(serverLog, `[verify-web-server] mode=${mode} cwd=${root} port=${port}`)

  if (!existsSync(join(root, 'node_modules', 'next', 'dist', 'bin', 'next'))) {
    throw new Error('Next.js binary not found in node_modules')
  }

  writeLine(buildLog, `[verify-web-server] starting next build for ${mode}`)
  const build = spawnNext(['scripts/build/next-build.mjs'], buildLog, 'next-build')
  await waitForExit(build, 'next build')
  writeLine(buildLog, '[verify-web-server] next build completed')

  const serverArgs = ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', port]

  writeLine(serverLog, `[verify-web-server] starting ${serverArgs.join(' ')}`)
  const child = spawnNext(serverArgs, serverLog, 'next-start')
  attachSignalForwarding(child)

  child.once('exit', (code, signal) => {
    writeLine(
      serverLog,
      `[verify-web-server] child exited with ${signal ? `signal ${signal}` : `code ${code ?? 0}`}`,
    )
    serverLog.end()
    buildLog.end()
    process.exit(code ?? 1)
  })
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error)
  writeLine(serverLog, `[verify-web-server] failed: ${message}`)
  writeLine(buildLog, `[verify-web-server] failed: ${message}`)
  console.error(error instanceof Error ? error.message : String(error))
  serverLog.end()
  buildLog.end()
  process.exit(1)
})
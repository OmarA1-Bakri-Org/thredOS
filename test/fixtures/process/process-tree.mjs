import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'

const mode = process.argv[2] ?? 'root'
const pidFile = process.argv[3]
const rootPid = Number.parseInt(process.argv[4] ?? '0', 10)

if (process.platform !== 'win32') {
  process.on('SIGTERM', () => {})
}

if (mode === 'leaf') {
  setInterval(() => {}, 60_000)
} else if (mode === 'child') {
  if (!pidFile || !Number.isInteger(rootPid) || rootPid <= 0) {
    throw new Error('child mode requires a PID file and root PID')
  }
  const leaf = spawn(process.execPath, [import.meta.filename, 'leaf'], {
    detached: false,
    stdio: 'ignore',
  })
  await writeFile(pidFile, JSON.stringify({
    root: rootPid,
    child: process.pid,
    grandchild: leaf.pid,
  }), 'utf8')
  setInterval(() => {}, 60_000)
} else {
  if (!pidFile) throw new Error('root mode requires a PID file')
  spawn(process.execPath, [import.meta.filename, 'child', pidFile, String(process.pid)], {
    detached: false,
    stdio: 'ignore',
  })
  process.stdout.write('READY\n')
  setInterval(() => {}, 60_000)
}

import { writeFile } from 'node:fs/promises'

const pidFile = process.argv[2]
const ignoreTerm = process.argv.includes('--ignore-term')

if (pidFile) {
  await writeFile(pidFile, String(process.pid), 'utf8')
}

if (ignoreTerm && process.platform !== 'win32') {
  process.on('SIGTERM', () => {
    process.stdout.write('IGNORED_SIGTERM\n')
  })
}

process.stdout.write('READY\n')
setInterval(() => {}, 60_000)

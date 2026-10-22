import { describe, expect, test } from 'bun:test'
import { spawn } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { isProcessAlive, isProcessGroupAlive, type ProcessObservationDependencies } from './process-observation'

function stat(pid: number, state = 'Z', groupId = 20, startTime = '100', threads = 1): string {
  const fields = Array<string>(20).fill('0')
  fields[0] = state
  fields[2] = String(groupId)
  fields[17] = String(threads)
  fields[19] = startTime
  return `${pid} (name with ) parentheses) ${fields.join(' ')}`
}

function fixture(overrides: Partial<ProcessObservationDependencies> = {}): ProcessObservationDependencies {
  return {
    platform: 'linux', currentPid: 10, signalZero: () => {},
    listProcesses: () => ['10', '21'],
    readText: path => {
      if (path === '/proc/self/stat') return stat(10, 'R', 10)
      if (path === '/proc/self/status') return 'NStgid:\t10\n'
      if (path === '/proc/self/mountinfo') return '1 0 0:1 / /proc rw - proc proc rw\n'
      if (path === '/proc/10/stat') return stat(10, 'R', 10)
      if (path === '/proc/21/stat') return stat(21)
      throw Object.assign(new Error('gone'), { code: 'ENOENT' })
    },
    ...overrides,
  }
}

describe('process observation', () => {
  test('recognizes exited zombies while the kernel still reports an existing PID and process group', () => {
    const system = fixture()
    expect(isProcessAlive(21, system)).toBe(false)
    expect(isProcessGroupAlive(20, system)).toBe(false)
  })

  test.each(['R', 'S', 'D', 'T', 't', 'I', 'Q'])(
    'a %s group member prevents reporting tree death', state => {
      const system = fixture()
      const read = system.readText
      system.readText = path => path === '/proc/21/stat' ? stat(21, state) : read(path)
      expect(isProcessGroupAlive(20, system)).toBe(true)
    },
  )

  test('a live leader prevents reporting death even when its descendants are zombies', () => {
    const system = fixture()
    const read = system.readText
    system.readText = path => path === '/proc/20/stat' ? stat(20, 'S') : read(path)
    expect(isProcessGroupAlive(20, system)).toBe(true)
  })

  test('a zombie leader with other threads is still alive', () => {
    const system = fixture()
    const read = system.readText
    system.readText = path => path === '/proc/21/stat' ? stat(21, 'Z', 20, '100', 2) : read(path)
    expect(isProcessAlive(21, system)).toBe(true)
    expect(isProcessGroupAlive(20, system)).toBe(true)
  })

  test('empty or inaccessible scans never prove absence', () => {
    expect(isProcessGroupAlive(20, fixture({ listProcesses: () => [] }))).toBe(true)
    expect(isProcessGroupAlive(20, fixture({ listProcesses: () => { throw new Error('denied') } }))).toBe(true)
  })

  test.each(['EACCES', 'EPERM', 'EIO'])('an unreadable process record (%s) keeps the group alive', code => {
    const system = fixture({ listProcesses: () => ['10', '21', '99'] })
    const read = system.readText
    system.readText = path => {
      if (path === '/proc/99/stat') throw Object.assign(new Error('unreadable'), { code })
      return read(path)
    }
    expect(isProcessGroupAlive(20, system)).toBe(true)
  })

  test.each(['hidepid=2', 'hidepid=invisible', 'hidepid=ptraceable'])(
    'restricted proc visibility (%s) cannot prove a zombie-only group', option => {
      const system = fixture()
      const read = system.readText
      system.readText = path => path === '/proc/self/mountinfo' ? `1 0 0:1 / /proc rw - proc proc rw,${option}\n` : read(path)
      expect(isProcessGroupAlive(20, system)).toBe(true)
    },
  )

  test('a different proc PID namespace cannot prove absence', () => {
    const system = fixture()
    const read = system.readText
    system.readText = path => path === '/proc/self/stat' ? stat(999, 'R') : read(path)
    expect(isProcessGroupAlive(20, system)).toBe(true)
  })

  test.each(['NStgid:\t10\t10\n', 'NStgid:\t999\n', '', 'NStgid:\t10\nNStgid:\t10\n', 'NStgid:\t10\t10\nNStgid:\t10\n'])(
    'unverified PID namespace hierarchy keeps observations alive (%j)', status => {
      const system = fixture()
      const read = system.readText
      system.readText = path => path === '/proc/self/status' ? status : read(path)
      expect(isProcessAlive(21, system)).toBe(true)
      expect(isProcessGroupAlive(20, system)).toBe(true)
    },
  )

  test.each(['/proc/99', '/proc/99/stat', '/proc/self', '/proc/self/stat', '/proc/thread-self'])(
    'process metadata overmount %s keeps observations alive', mountPoint => {
      const system = fixture()
      const read = system.readText
      system.readText = path => path === '/proc/self/mountinfo'
        ? `1 0 0:1 / /proc rw - proc proc rw\n2 1 0:2 / ${mountPoint} rw - tmpfs tmpfs rw\n` : read(path)
      expect(isProcessAlive(21, system)).toBe(true)
      expect(isProcessGroupAlive(20, system)).toBe(true)
    },
  )

  test('a proc subtree view or changed mount generation cannot prove absence', () => {
    const partial = fixture()
    const read = partial.readText
    partial.readText = path => path === '/proc/self/mountinfo' ? '1 0 0:1 /partial /proc rw - proc proc rw\n' : read(path)
    expect(isProcessGroupAlive(20, partial)).toBe(true)

    const changing = fixture()
    const original = changing.readText
    let reads = 0
    changing.readText = path => path === '/proc/self/mountinfo'
      ? `${++reads} 0 0:1 / /proc rw - proc proc rw\n` : original(path)
    expect(isProcessGroupAlive(20, changing)).toBe(true)
  })

  test('missing, malformed, or unreadable proc mount evidence keeps the group alive', () => {
    for (const mount of ['', '1 0 0:1 / /proc rw - proc', '1 0 0:1 / /proc rw - tmpfs tmpfs rw']) {
      const system = fixture()
      const read = system.readText
      system.readText = path => path === '/proc/self/mountinfo' ? mount : read(path)
      expect(isProcessGroupAlive(20, system)).toBe(true)
    }
    const system = fixture()
    const read = system.readText
    system.readText = path => {
      if (path === '/proc/self/mountinfo') throw Object.assign(new Error('unreadable'), { code: 'EACCES' })
      return read(path)
    }
    expect(isProcessGroupAlive(20, system)).toBe(true)
  })

  test('PID generation changes and newly observed live members keep the group alive', () => {
    const changing = fixture()
    const read = changing.readText
    let reads = 0
    changing.readText = path => path === '/proc/21/stat' ? stat(21, 'Z', 20, String(++reads)) : read(path)
    expect(isProcessGroupAlive(20, changing)).toBe(true)
    expect(isProcessAlive(21, changing)).toBe(true)

    const appearing = fixture()
    let scans = 0
    appearing.listProcesses = () => ++scans === 1 ? ['10', '21'] : ['10', '21', '22']
    const original = appearing.readText
    appearing.readText = path => path === '/proc/22/stat' ? stat(22, 'S') : original(path)
    expect(isProcessGroupAlive(20, appearing)).toBe(true)

    const replaced = fixture()
    let snapshots = 0
    replaced.listProcesses = () => ++snapshots === 1 ? ['10', '21'] : ['10', '22']
    const before = replaced.readText
    replaced.readText = path => path === '/proc/22/stat' ? stat(22) : before(path)
    expect(isProcessGroupAlive(20, replaced)).toBe(true)
  })

  test('malformed records and mismatched PID associations keep the group alive', () => {
    for (const record of ['malformed', stat(999)]) {
      const system = fixture()
      const read = system.readText
      system.readText = path => path === '/proc/21/stat' ? record : read(path)
      expect(isProcessGroupAlive(20, system)).toBe(true)
    }
  })

  test('signal permission errors stay alive and ESRCH remains absent on every platform', () => {
    for (const platform of ['linux', 'win32', 'darwin'] as const) {
      for (const code of ['EPERM', 'ESRCH']) {
        const system = fixture({ platform, signalZero: () => { throw Object.assign(new Error(code), { code }) } })
        expect(isProcessAlive(21, system)).toBe(code !== 'ESRCH')
        expect(isProcessGroupAlive(20, system)).toBe(code !== 'ESRCH')
      }
    }
  })

  test('other platforms retain their existing signal targets without consulting proc', () => {
    for (const platform of ['win32', 'darwin'] as const) {
      const targets: number[] = []
      const system = fixture({ platform, signalZero: target => { targets.push(target) }, readText: () => { throw new Error('must not read proc') } })
      expect(isProcessGroupAlive(20, system)).toBe(true)
      expect(targets).toEqual([platform === 'win32' ? 20 : -20])
    }
  })

  test.skipIf(process.platform !== 'linux')('real live members stay alive while zombie-only PIDs and groups are exited', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'threados-process-observation-'))
    const pidFile = join(directory, 'pids.json')
    const releaseFile = join(directory, 'release')
    const worker = spawn('node', ['-e', `
      const { spawn } = require('child_process')
      const { existsSync, writeFileSync } = require('fs')
      const children = [false, true].map(detached => spawn(process.execPath, ['-e', 'process.exit(0)'], { detached, stdio: 'ignore' }))
      let remaining = children.length
      for (const child of children) child.once('close', () => { if (--remaining === 0) process.exit(0) })
      writeFileSync(process.argv[1], JSON.stringify(children.map(child => child.pid)))
      const deadline = Date.now() + 10000
      while (!existsSync(process.argv[2]) && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
    `, pidFile, releaseFile], { detached: true, stdio: 'ignore' })
    const exit = new Promise<void>((resolve, reject) => {
      worker.once('error', reject)
      worker.once('close', code => code === 0 ? resolve() : reject(new Error(`Observation worker exited ${code}`)))
    })
    try {
      let pids: number[] | undefined
      for (let poll = 0; poll < 250; poll++) {
        try {
          pids = JSON.parse(await readFile(pidFile, 'utf8')) as number[]
          const states = await Promise.all(pids.map(pid => readFile(`/proc/${pid}/stat`, 'utf8')))
          if (states.every(value => value.slice(value.lastIndexOf(')') + 2).startsWith('Z '))) break
        } catch { /* Wait for the owned children to exit while their parent deliberately defers reaping. */ }
        pids = undefined
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      if (!pids || !worker.pid) throw new Error('No real zombie evidence was observed')
      process.kill(pids[1]!, 0)
      process.kill(-pids[1]!, 0)
      expect(isProcessAlive(worker.pid)).toBe(true)
      expect(isProcessGroupAlive(worker.pid)).toBe(true)
      expect(isProcessAlive(pids[0]!)).toBe(false)
      expect(isProcessAlive(pids[1]!)).toBe(false)
      expect(isProcessGroupAlive(pids[1]!)).toBe(false)
    } finally {
      await writeFile(releaseFile, 'release')
      await exit
      await rm(directory, { recursive: true, force: true })
    }
  }, 15_000)
})

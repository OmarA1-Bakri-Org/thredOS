import { readFileSync, readdirSync } from 'fs'

export interface ProcessObservationDependencies {
  platform: NodeJS.Platform
  currentPid: number
  signalZero(target: number): void
  readText(path: string): string
  listProcesses(): string[]
}

const native: ProcessObservationDependencies = {
  platform: process.platform,
  currentPid: process.pid,
  signalZero: target => process.kill(target, 0),
  readText: path => readFileSync(path, 'utf8'),
  listProcesses: () => readdirSync('/proc'),
}

function existence(target: number, system: ProcessObservationDependencies): 'present' | 'absent' | 'unknown' {
  try {
    system.signalZero(target)
    return 'present'
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'absent' : 'unknown'
  }
}

interface LinuxProcess {
  pid: number
  groupId: number
  state: string
  startTime: string
  threads: number
}

function readProcess(pid: number, system: ProcessObservationDependencies): LinuxProcess {
  const raw = system.readText(`/proc/${pid}/stat`)
  return parseProcess(raw, pid)
}

function parseProcess(raw: string, expectedPid: number): LinuxProcess {
  const open = raw.indexOf('(')
  const close = raw.lastIndexOf(')')
  const fields = raw.slice(close + 2).trim().split(/\s+/)
  // comm may itself contain spaces and parentheses. Fields after its final ')'
  // start at state (3); pgrp is field 5 and starttime is field 22.
  if (open < 1 || close <= open || raw[close + 1] !== ' '
    || raw.slice(0, open).trim() !== String(expectedPid)
    || !/^[A-Za-z]$/.test(fields[0] ?? '')
    || !/^[1-9]\d*$/.test(fields[2] ?? '')
    || !/^[1-9]\d*$/.test(fields[17] ?? '')
    || !/^\d+$/.test(fields[19] ?? '')) {
    throw new Error('Unusable proc process identity')
  }
  const groupId = Number(fields[2])
  const threads = Number(fields[17])
  if (!Number.isSafeInteger(groupId) || !Number.isSafeInteger(threads)) throw new Error('Unusable proc group identity')
  return { pid: expectedPid, groupId, state: fields[0]!, startTime: fields[19]!, threads }
}

function procView(system: ProcessObservationDependencies): string | null {
  parseProcess(system.readText('/proc/self/stat'), system.currentPid)
  // NStgid lists the mounted proc namespace first and then each nested one.
  // Numeric equality alone would miss coincidentally equal PIDs in two namespaces.
  // https://man7.org/linux/man-pages/man5/proc_pid_status.5.html
  const identities = system.readText('/proc/self/status').split('\n').filter(line => line.startsWith('NStgid:'))
  const identity = identities.length === 1 ? /^NStgid:[ \t]+([1-9]\d*)[ \t]*$/.exec(identities[0]!) : null
  if (identity?.[1] !== String(system.currentPid)) return null
  const mountInfo = system.readText('/proc/self/mountinfo')
  const allMounts = mountInfo.trim().split('\n').map(line => line.split(' - '))
  if (allMounts.some(parts => /^\/proc\/(?:\d+|self|thread-self)(?:\/|$)/.test(parts[0]?.split(' ')[4] ?? ''))) return null
  const mounts = allMounts.filter(parts => parts[0]?.split(' ')[4] === '/proc')
  if (mounts.length !== 1) return null
  const [left, right] = mounts[0]!
  const mount = left?.split(' ')
  const filesystem = right?.split(' ')
  if (mount?.[3] !== '/' || !mount[5] || filesystem?.[0] !== 'proc' || !filesystem[2]) return null
  const options = `${mount[5]},${filesystem[2]}`.split(',')
  // hidepid can omit other users' live members entirely. A partial view is
  // never evidence of a zombie-only group, even if the visible PIDs are dead.
  if (options.some(option => option === 'hidepid' || (option.startsWith('hidepid=') && option !== 'hidepid=0'))) return null
  return mountInfo
}

function zombieMembers(groupId: number, system: ProcessObservationDependencies): string[] | null {
  const members: string[] = []
  for (const name of system.listProcesses()) {
    if (!/^[1-9]\d*$/.test(name)) continue
    const pid = Number(name)
    if (!Number.isSafeInteger(pid)) return null
    let entry: LinuxProcess
    try {
      entry = readProcess(pid, system)
    } catch (error) {
      if (['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) continue
      return null
    }
    if (entry.groupId !== groupId) continue
    // Only a positively identified zombie is excluded. Stopped, idle, unknown,
    // and every other state remain alive for process-control decisions.
    // A dead thread-group leader can still have executing worker threads.
    // Only a zombie with exactly one remaining thread proves the process exited.
    // https://man7.org/linux/man-pages/man3/pthread_exit.3.html
    if (entry.state !== 'Z' || entry.threads !== 1) return null
    members.push(`${entry.pid}:${entry.startTime}`)
  }
  return members.sort()
}

/** Exited-but-unreaped Linux zombies cannot execute; ambiguous evidence stays alive. */
export function isProcessAlive(pid: number, system = native): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true
  const observed = existence(pid, system)
  if (observed !== 'present' || system.platform !== 'linux') return observed !== 'absent'
  try {
    const view = procView(system)
    if (view === null) return true
    const first = readProcess(pid, system)
    if (first.state !== 'Z' || first.threads !== 1) return true
    const second = readProcess(pid, system)
    return second.state !== 'Z' || second.threads !== 1 || second.startTime !== first.startTime
      || second.groupId !== first.groupId || procView(system) !== view || existence(pid, system) === 'unknown'
  } catch {
    return true
  }
}

export function isProcessGroupAlive(groupId: number, system = native): boolean {
  if (!Number.isSafeInteger(groupId) || groupId <= 1) return true
  const target = system.platform === 'win32' ? groupId : -groupId
  const observed = existence(target, system)
  if (observed !== 'present' || system.platform !== 'linux') return observed !== 'absent'
  try {
    // The common live-leader case needs no system-wide scan.
    try {
      const leader = readProcess(groupId, system)
      if (leader.groupId === groupId && (leader.state !== 'Z' || leader.threads !== 1)) return true
    } catch (error) {
      if (!['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) return true
    }
    const view = procView(system)
    if (view === null) return true
    // kill(2) tests existence, including unreaped zombies. Require two complete
    // nonempty observations of the same exited generations before treating
    // that group as no longer executable. Empty or changing scans prove nothing.
    // https://man7.org/linux/man-pages/man2/kill.2.html
    // https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html
    const first = zombieMembers(groupId, system)
    if (!first?.length) return true
    const second = zombieMembers(groupId, system)
    if (!second?.length || first.length !== second.length || first.some((value, index) => value !== second[index])) return true
    return procView(system) !== view || existence(target, system) === 'unknown'
  } catch {
    return true
  }
}

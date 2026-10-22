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

function hasCurrentPidNamespace(system: ProcessObservationDependencies): boolean {
  parseProcess(system.readText('/proc/self/stat'), system.currentPid)
  // NStgid lists the mounted proc namespace first and then each nested one.
  // Numeric equality alone would miss coincidentally equal PIDs in two namespaces.
  // https://man7.org/linux/man-pages/man5/proc_pid_status.5.html
  const identities = system.readText('/proc/self/status').split('\n').filter(line => line.startsWith('NStgid:'))
  const identity = identities.length === 1 ? /^NStgid:[ \t]+([1-9]\d*)[ \t]*$/.exec(identities[0]!) : null
  return identity?.[1] === String(system.currentPid)
}

function completeProcMount(parts: string[]): boolean {
  const [left, right] = parts
  const mount = left?.split(' ')
  const filesystem = right?.split(' ')
  if (mount?.[3] !== '/' || !mount[5] || filesystem?.[0] !== 'proc' || !filesystem[2]) return false
  const options = `${mount[5]},${filesystem[2]}`.split(',')
  // hidepid can omit other users' live members entirely. A partial view is
  // never evidence of a zombie-only group, even if the visible PIDs are dead.
  return !options.some(option => option === 'hidepid' || (option.startsWith('hidepid=') && option !== 'hidepid=0'))
}

function hasCompleteProcMount(mountInfo: string): boolean {
  const allMounts = mountInfo.trim().split('\n').map(line => line.split(' - '))
  if (allMounts.some(parts => /^\/proc\/(?:\d+|self|thread-self)(?:\/|$)/.test(parts[0]?.split(' ')[4] ?? ''))) return false
  const mounts = allMounts.filter(parts => parts[0]?.split(' ')[4] === '/proc')
  return mounts.length === 1 && completeProcMount(mounts[0]!)
}

function procView(system: ProcessObservationDependencies): string | null {
  if (!hasCurrentPidNamespace(system)) return null
  const mountInfo = system.readText('/proc/self/mountinfo')
  return hasCompleteProcMount(mountInfo) ? mountInfo : null
}

function processIds(system: ProcessObservationDependencies): number[] | null {
  const ids: number[] = []
  for (const name of system.listProcesses()) {
    if (!/^[1-9]\d*$/.test(name)) continue
    const pid = Number(name)
    if (!Number.isSafeInteger(pid)) return null
    ids.push(pid)
  }
  return ids
}

function readVisibleProcess(pid: number, system: ProcessObservationDependencies): LinuxProcess | null {
  try {
    return readProcess(pid, system)
  } catch (error) {
    if (['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) return null
    throw error
  }
}

function singleThreadZombie(entry: LinuxProcess): boolean {
  // A dead thread-group leader can still have executing worker threads.
  // https://man7.org/linux/man-pages/man3/pthread_exit.3.html
  return entry.state === 'Z' && entry.threads === 1
}

function zombieMembers(groupId: number, system: ProcessObservationDependencies): string[] | null {
  const ids = processIds(system)
  if (!ids) return null
  const members: string[] = []
  for (const pid of ids) {
    const entry = readVisibleProcess(pid, system)
    if (!entry || entry.groupId !== groupId) continue
    // Stopped, idle, unknown, and every other state remain alive.
    if (!singleThreadZombie(entry)) return null
    members.push(`${entry.pid}:${entry.startTime}`)
  }
  return members.sort()
}

function sameExitedProcess(first: LinuxProcess, second: LinuxProcess): boolean {
  return singleThreadZombie(second) && second.startTime === first.startTime && second.groupId === first.groupId
}

function linuxProcessExited(pid: number, system: ProcessObservationDependencies): boolean {
  const view = procView(system)
  if (view === null) return false
  const first = readProcess(pid, system)
  if (!singleThreadZombie(first)) return false
  const second = readProcess(pid, system)
  if (!sameExitedProcess(first, second)) return false
  return procView(system) === view && existence(pid, system) !== 'unknown'
}

/** Exited-but-unreaped Linux zombies cannot execute; ambiguous evidence stays alive. */
export function isProcessAlive(pid: number, system = native): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true
  const observed = existence(pid, system)
  if (observed !== 'present') return observed !== 'absent'
  if (system.platform !== 'linux') return true
  try {
    return !linuxProcessExited(pid, system)
  } catch {
    return true
  }
}

function liveGroupLeader(groupId: number, system: ProcessObservationDependencies): boolean {
  const leader = readVisibleProcess(groupId, system)
  if (!leader) return false
  return leader.groupId === groupId && !singleThreadZombie(leader)
}

function sameZombieMembers(first: string[], second: string[] | null): boolean {
  return !!second?.length && first.length === second.length && first.every((value, index) => value === second[index])
}

function linuxGroupExited(groupId: number, system: ProcessObservationDependencies): boolean {
  // The common live-leader case needs no system-wide scan.
  if (liveGroupLeader(groupId, system)) return false
  const view = procView(system)
  if (view === null) return false
  // kill(2) tests existence, including unreaped zombies. Require two complete
  // nonempty observations of the same exited generations before treating
  // that group as no longer executable. Empty or changing scans prove nothing.
  // https://man7.org/linux/man-pages/man2/kill.2.html
  // https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html
  const first = zombieMembers(groupId, system)
  if (!first?.length) return false
  if (!sameZombieMembers(first, zombieMembers(groupId, system))) return false
  return procView(system) === view && existence(-groupId, system) !== 'unknown'
}

export function isProcessGroupAlive(groupId: number, system = native): boolean {
  if (!Number.isSafeInteger(groupId) || groupId <= 1) return true
  const target = system.platform === 'win32' ? groupId : -groupId
  const observed = existence(target, system)
  if (observed !== 'present') return observed !== 'absent'
  if (system.platform !== 'linux') return true
  try {
    return !linuxGroupExited(groupId, system)
  } catch {
    return true
  }
}

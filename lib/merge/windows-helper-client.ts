import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { readWindowsHelperJournal } from './helper-recovery'
import { WindowsHelperJournalSchema, WindowsHelperRequestSchema,
  type WindowsHelperJournal, type WindowsHelperRequest, type WindowsHelperResult } from './windows-helper-types'

export { classifyWindowsHelperRecovery, readWindowsHelperJournal } from './helper-recovery'

const MAX_OUTPUT_BYTES = 16 * 1024

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

async function durableWrite(path: string, record: WindowsHelperJournal, first: boolean): Promise<void> {
  const content = `${JSON.stringify(WindowsHelperJournalSchema.parse(record))}\n`
  const target = first ? path : `${path}.${process.pid}.tmp`
  const handle = await open(target, 'wx', 0o600)
  try { await handle.writeFile(content); await handle.sync() } finally { await handle.close() }
  if (!first) {
    try { await rename(target, path) } catch (error) { await unlink(target).catch(() => {}); throw error }
  }
}

function contains(root: string, path: string): boolean {
  const part = relative(resolve(root), resolve(path))
  return part === '' || (!isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`))
}

async function verifiedJournalDir(journalDir: string, canonicalRoot: string): Promise<string> {
  const path = resolve(journalDir)
  const stat = await lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== path) {
    throw new Error('MERGE_HELPER_UNSAFE_JOURNAL_ROOT')
  }
  if (contains(canonicalRoot, path) || contains(path, canonicalRoot)) {
    throw new Error('MERGE_HELPER_JOURNAL_MUST_BE_EXTERNAL')
  }
  return path
}


export async function runWindowsApplyHelper(input: {
  request: WindowsHelperRequest
  journalDir: string
  helperPath: string
  executablePath: string
  timeoutMs: number
}): Promise<WindowsHelperResult> {
  const request = WindowsHelperRequestSchema.parse(input.request)
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 600_000) {
    throw new Error('MERGE_HELPER_INVALID_TIMEOUT')
  }
  const journalDir = await verifiedJournalDir(input.journalDir, request.root)
  const helperPath = resolve(input.helperPath)
  if (!(await lstat(helperPath)).isFile()) throw new Error('MERGE_HELPER_MISSING_EXECUTABLE')
  const journalPath = join(journalDir, `${request.operation_id}.json`)
  const serialized = JSON.stringify(request)
  if (Buffer.byteLength(serialized) > MAX_OUTPUT_BYTES) throw new Error('MERGE_HELPER_REQUEST_TOO_LARGE')
  let journal: WindowsHelperJournal = {
    schema_version: 1, operation_id: request.operation_id, request_hash: digest(serialized),
    plan_id: request.plan_id, plan_hash: request.plan_hash, preview_hash: request.preview_hash,
    approval_hash: request.approval_hash, root_hash: request.root_hash,
    phase: 'launch', pid: null, exit_code: null, result: null, error_code: null,
    source_identity_after: null, destination_identity_after: null, updated_at: new Date().toISOString(),
  }
  await durableWrite(journalPath, journal, true)
  const child = spawn(input.executablePath, [helperPath, journalPath], {
    shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { NODE_ENV: process.env.NODE_ENV ?? 'production', PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
      ELECTRON_RUN_AS_NODE: '1' },
  })
  try {
    await new Promise<void>((resolveSpawn, rejectSpawn) => {
      child.once('spawn', () => resolveSpawn())
      child.once('error', rejectSpawn)
    })
    journal = { ...journal, pid: child.pid ?? null, updated_at: new Date().toISOString() }
    await durableWrite(journalPath, journal, false)
  } catch {
    child.kill()
    return { status: child.pid ? 'indeterminate' : 'failed', operationId: request.operation_id, journalPath, pid: child.pid ?? null,
      exitCode: null, code: 'MERGE_HELPER_LAUNCH_FAILED' }
  }
  let output = ''
  let outputBytes = 0
  let outputExceeded = false
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk: Buffer) => {
    outputBytes += chunk.length
    if (outputBytes > MAX_OUTPUT_BYTES) {
      outputExceeded = true
      child.kill()
    } else if (stream === child.stdout) output += chunk.toString('utf8')
  })
  child.stdin.on('error', () => { /* close/journal state determines the result */ })
  child.stdin.end(`${serialized}\n`)
  const exitCode = await new Promise<number | null>((resolveExit) => {
    let done = false
    const finish = (code: number | null) => { if (done) return; done = true; clearTimeout(timer); resolveExit(code) }
    // Kill requests do not prove cancellation of NT I/O already pending in the child.
    // The service must reconcile journal, process and canonical identities before retry/rollback.
    const timer = setTimeout(() => { child.kill(); finish(null) }, input.timeoutMs)
    child.once('close', code => finish(code))
    child.once('error', () => finish(null))
  })
  let latest: WindowsHelperJournal | null = null
  try { latest = await readWindowsHelperJournal(journalPath) } catch { /* incomplete journal is indeterminate */ }
  const common = { operationId: request.operation_id, journalPath, pid: child.pid ?? null, exitCode }
  if (latest?.request_hash !== journal.request_hash || latest?.operation_id !== request.operation_id ||
      latest.plan_hash !== request.plan_hash || latest.preview_hash !== request.preview_hash ||
      latest.approval_hash !== request.approval_hash || latest.root_hash !== request.root_hash) {
    return { ...common, status: 'indeterminate', code: 'MERGE_HELPER_JOURNAL_MISMATCH' }
  }
  if (latest.phase === 'terminal' && latest.result === 'succeeded' && exitCode === 0 && !outputExceeded) {
    try {
      const result = JSON.parse(output.trim()) as { status?: unknown; operation_id?: unknown }
      if (result.status === 'succeeded' && result.operation_id === request.operation_id) {
        return { ...common, status: 'succeeded', code: 'MERGE_HELPER_SUCCEEDED' }
      }
    } catch { /* journal is retained for recovery */ }
  }
  if ((latest.phase === 'terminal' && latest.result === 'failed') ||
      (exitCode !== null && (latest.phase === 'launch' || latest.phase === 'prepared'))) {
    return { ...common, status: 'failed', code: latest.error_code ?? 'MERGE_HELPER_NO_MUTATION' }
  }
  return { ...common, status: 'indeterminate', code: outputExceeded ? 'MERGE_HELPER_OUTPUT_LIMIT'
    : exitCode === null ? 'MERGE_HELPER_TIMEOUT_OR_LOST' : 'MERGE_HELPER_STARTED_WITHOUT_TERMINAL_RESULT' }
}

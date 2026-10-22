import type { PolicyResult, ExecutablePayload } from '@/lib/policy/schema'
import type { WorkspaceDispatchContext } from '@/lib/runtime/workspace-planner'
import { redactSecrets } from '@/lib/audit/logger'
import { realpath } from 'fs/promises'
import { isAbsolute, normalize, parse, relative, resolve } from 'path'

export interface ParsedBootstrapCommand {
  command: string
  args: string[]
}

export type BootstrapArtifactStatus = 'success' | 'failed' | 'policy_blocked' | 'error'

export interface BootstrapArtifact {
  schema_version: 1
  workspace_id: string
  attempt_id: string
  index: number
  command: string
  args: string[]
  stdout: string
  stderr: string
  duration_ms: number
  exit_code: number | null
  status: BootstrapArtifactStatus
  error_message?: string
}

export interface BootstrapExecutionOptions {
  cwd: string
  shell: false
  timeoutMs: number
  maxOutputBytes: number
}

export interface BootstrapExecutionResult {
  exitCode: number | null
  stdout: string
  stderr: string
}

export interface RunWorkspaceBootstrapInput {
  commands: string[]
  canonicalRoot: string
  context: WorkspaceDispatchContext
  evaluatePolicy(payload: ExecutablePayload): PolicyResult
  execute(payload: ExecutablePayload, options: BootstrapExecutionOptions): Promise<BootstrapExecutionResult>
  writeArtifact(artifact: BootstrapArtifact): Promise<void>
  timeoutMs?: number
  maxOutputBytes?: number
  nowMs?: () => number
}

export class WorkspaceBootstrapError extends Error {
  readonly code = 'WORKSPACE_BOOTSTRAP_FAILED' as const

  constructor(message: string, public readonly commandIndex: number | null, public readonly cause?: unknown) {
    super(message)
    this.name = 'WorkspaceBootstrapError'
  }
}

export function parseBootstrapCommand(_source: string): ParsedBootstrapCommand {
  const source = _source.trim()
  if (source.length === 0) throw new Error('Bootstrap command must not be empty')

  const tokens: string[] = []
  let token = ''
  let tokenStarted = false
  let quote: 'single' | 'double' | null = null

  const appendToken = (): void => {
    if (!tokenStarted) return
    tokens.push(token)
    token = ''
    tokenStarted = false
  }

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!
    if (quote === null && /[|&;<>\r\n]/.test(character)) {
      throw new Error('Bootstrap command contains unsupported shell operator: ' + character)
    }
    if (quote === null && (character === '$' && source[index + 1] === '(' || character === String.fromCharCode(96))) {
      throw new Error('Bootstrap command contains unsupported shell operator')
    }
    if (character === "'" && quote !== 'double') {
      quote = quote === 'single' ? null : 'single'
      tokenStarted = true
      continue
    }
    if (character === '"' && quote !== 'single') {
      quote = quote === 'double' ? null : 'double'
      tokenStarted = true
      continue
    }
    if (quote === null && /\s/.test(character)) {
      appendToken()
      continue
    }
    if (character === '\\' && quote !== 'single') {
      const next = source[index + 1]
      const escapable = next !== undefined
        && (next === '\\' || next === '"' || next === "'" || (quote === null && /\s/.test(next)))
      if (escapable) {
        token += next
        tokenStarted = true
        index += 1
        continue
      }
    }
    token += character
    tokenStarted = true
  }

  if (quote !== null) throw new Error('Bootstrap command contains an unterminated quote')
  appendToken()
  if (tokens.length === 0 || tokens[0]!.length === 0) {
    throw new Error('Bootstrap command must include an executable')
  }
  return { command: tokens[0]!, args: tokens.slice(1) }
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1_000
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1_024
const SECRET_FLAG = /^--?(?:password|secret|token|key|api[_-]?key|auth|credentials|private[_-]?key|access[_-]?token|bearer)(?:=|$)/i

function pathIdentity(path: string): string {
  const normalized = resolve(path)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function sameOrWithin(parent: string, candidate: string): boolean {
  const child = relative(pathIdentity(parent), pathIdentity(candidate))
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}

function lexicalPathIdentity(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

function assertLexicallySafeAbsolutePath(path: string, label: string): string {
  if (!isAbsolute(path)) throw new Error(label + ' must be absolute')
  const root = parse(path).root
  const remainder = path.slice(root.length)
  const segments = remainder.split(process.platform === 'win32' ? /[\\/]/ : /\//)
  if (segments.some(segment => segment === '.' || segment === '..')) {
    throw new Error(label + ' must not contain dot segments')
  }
  const normalized = normalize(path)
  if (lexicalPathIdentity(path) !== lexicalPathIdentity(normalized)) {
    throw new Error(label + ' must be an exact normalized platform path')
  }
  return path
}

async function assertSafeBootstrapRoot(input: RunWorkspaceBootstrapInput): Promise<string> {
  if (input.context.isolationLabel !== 'THREADOS_SCOPED') {
    throw new WorkspaceBootstrapError('Bootstrap requires a THREADOS_SCOPED workspace', null)
  }
  try {
    const workspaceLexical = assertLexicallySafeAbsolutePath(input.context.cwd, 'workspace root')
    const canonicalLexical = assertLexicallySafeAbsolutePath(input.canonicalRoot, 'canonical root')
    const [workspaceRoot, canonicalRoot] = await Promise.all([
      realpath(workspaceLexical),
      realpath(canonicalLexical),
    ])
    if (lexicalPathIdentity(workspaceLexical) !== lexicalPathIdentity(workspaceRoot)) {
      throw new Error('workspace root resolves through an alias or symbolic link')
    }
    if (sameOrWithin(canonicalRoot, workspaceRoot) || sameOrWithin(workspaceRoot, canonicalRoot)) {
      throw new Error('workspace root overlaps the canonical project')
    }
    return workspaceRoot
  } catch (error) {
    if (error instanceof WorkspaceBootstrapError) throw error
    throw new WorkspaceBootstrapError(
      error instanceof Error ? error.message : 'Bootstrap workspace root is unsafe',
      null,
      error,
    )
  }
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value
  const marker = '[TRUNCATED]'
  const markerBytes = Buffer.byteLength(marker, 'utf8')
  if (maxBytes <= markerBytes) return marker.slice(0, maxBytes)
  const available = maxBytes - markerBytes
  let prefix = ''
  let bytes = 0
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8')
    if (bytes + characterBytes > available) break
    prefix += character
    bytes += characterBytes
  }
  return prefix + marker
}

function redactAndBound(value: string, maxBytes: number): string {
  return truncateUtf8(redactSecrets(value), maxBytes)
}

function redactArguments(args: string[]): string[] {
  let redactNext = false
  return args.map(argument => {
    if (redactNext) {
      redactNext = false
      return '[REDACTED]'
    }
    if (SECRET_FLAG.test(argument)) {
      redactNext = !argument.includes('=')
      return '[REDACTED]'
    }
    return redactSecrets(argument)
  })
}

function validateLimit(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new WorkspaceBootstrapError(label + ' must be a positive safe integer', null)
  }
  return value
}

async function persistArtifact(
  input: RunWorkspaceBootstrapInput,
  artifact: BootstrapArtifact,
  commandIndex: number,
): Promise<void> {
  try {
    await input.writeArtifact(artifact)
  } catch (error) {
    throw new WorkspaceBootstrapError(
      'Bootstrap artifact persistence failed for command ' + commandIndex,
      commandIndex,
      error,
    )
  }
}

export async function runWorkspaceBootstrap(
  input: RunWorkspaceBootstrapInput,
): Promise<BootstrapArtifact[]> {
  const workspaceRoot = await assertSafeBootstrapRoot(input)
  const timeoutMs = validateLimit(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'Bootstrap timeout')
  const maxOutputBytes = validateLimit(
    input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    'Bootstrap output limit',
  )
  const nowMs = input.nowMs ?? Date.now
  const artifacts: BootstrapArtifact[] = []

  for (let index = 0; index < input.commands.length; index += 1) {
    let parsed: ParsedBootstrapCommand
    try {
      parsed = parseBootstrapCommand(input.commands[index]!)
    } catch (error) {
      throw new WorkspaceBootstrapError('Bootstrap command ' + index + ' is invalid', index, error)
    }
    const payload: ExecutablePayload = {
      command: parsed.command,
      args: parsed.args,
      cwd: workspaceRoot,
    }
    const redactedCommand = redactSecrets(parsed.command)
    const redactedArgs = redactArguments(parsed.args)

    let policy: PolicyResult
    try {
      policy = input.evaluatePolicy(payload)
    } catch (error) {
      const artifact: BootstrapArtifact = {
        schema_version: 1,
        workspace_id: input.context.workspaceId,
        attempt_id: input.context.attemptId,
        index,
        command: redactedCommand,
        args: redactedArgs,
        stdout: '',
        stderr: '',
        duration_ms: 0,
        exit_code: null,
        status: 'policy_blocked',
        error_message: redactAndBound(
          error instanceof Error ? error.message : 'Policy evaluation failed',
          maxOutputBytes,
        ),
      }
      await persistArtifact(input, artifact, index)
      artifacts.push(artifact)
      throw new WorkspaceBootstrapError('Bootstrap policy evaluation failed for command ' + index, index, error)
    }

    if (!policy.allowed || policy.confirmation_required) {
      const artifact: BootstrapArtifact = {
        schema_version: 1,
        workspace_id: input.context.workspaceId,
        attempt_id: input.context.attemptId,
        index,
        command: redactedCommand,
        args: redactedArgs,
        stdout: '',
        stderr: '',
        duration_ms: 0,
        exit_code: null,
        status: 'policy_blocked',
        error_message: redactAndBound(
          policy.reason ?? (policy.confirmation_required ? 'Policy confirmation required' : 'Policy denied command'),
          maxOutputBytes,
        ),
      }
      await persistArtifact(input, artifact, index)
      artifacts.push(artifact)
      throw new WorkspaceBootstrapError('Bootstrap policy blocked command ' + index, index)
    }

    const startedAt = nowMs()
    let execution: BootstrapExecutionResult
    try {
      execution = await input.execute(payload, {
        cwd: workspaceRoot,
        shell: false,
        timeoutMs,
        maxOutputBytes,
      })
    } catch (error) {
      const artifact: BootstrapArtifact = {
        schema_version: 1,
        workspace_id: input.context.workspaceId,
        attempt_id: input.context.attemptId,
        index,
        command: redactedCommand,
        args: redactedArgs,
        stdout: '',
        stderr: '',
        duration_ms: Math.max(0, nowMs() - startedAt),
        exit_code: null,
        status: 'error',
        error_message: redactAndBound(
          error instanceof Error ? error.message : 'Bootstrap execution failed',
          maxOutputBytes,
        ),
      }
      await persistArtifact(input, artifact, index)
      artifacts.push(artifact)
      throw new WorkspaceBootstrapError('Bootstrap execution failed for command ' + index, index, error)
    }

    const artifact: BootstrapArtifact = {
      schema_version: 1,
      workspace_id: input.context.workspaceId,
      attempt_id: input.context.attemptId,
      index,
      command: redactedCommand,
      args: redactedArgs,
      stdout: redactAndBound(execution.stdout, maxOutputBytes),
      stderr: redactAndBound(execution.stderr, maxOutputBytes),
      duration_ms: Math.max(0, nowMs() - startedAt),
      exit_code: execution.exitCode,
      status: execution.exitCode === 0 ? 'success' : 'failed',
    }
    await persistArtifact(input, artifact, index)
    artifacts.push(artifact)
    if (execution.exitCode !== 0) {
      throw new WorkspaceBootstrapError(
        'Bootstrap command ' + index + ' exited with code ' + (execution.exitCode ?? 'unknown'),
        index,
      )
    }
  }

  return artifacts
}

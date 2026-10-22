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

type BootstrapQuote = 'single' | 'double' | null

interface BootstrapTokenState {
  tokens: string[]
  token: string
  tokenStarted: boolean
  quote: BootstrapQuote
}

function appendBootstrapToken(state: BootstrapTokenState): void {
  if (!state.tokenStarted) return
  state.tokens.push(state.token)
  state.token = ''
  state.tokenStarted = false
}

function assertBootstrapCharacter(source: string, index: number, quote: BootstrapQuote): void {
  if (quote !== null) return
  const character = source[index]!
  if (/[|&;<>\r\n]/.test(character)) {
    throw new Error('Bootstrap command contains unsupported shell operator: ' + character)
  }
  if ((character === '$' && source[index + 1] === '(') || character === String.fromCharCode(96)) {
    throw new Error('Bootstrap command contains unsupported shell operator')
  }
}

function consumeBootstrapQuote(character: string, state: BootstrapTokenState): boolean {
  if (character === "'" && state.quote !== 'double') {
    state.quote = state.quote === 'single' ? null : 'single'
    state.tokenStarted = true
    return true
  }
  if (character === '"' && state.quote !== 'single') {
    state.quote = state.quote === 'double' ? null : 'double'
    state.tokenStarted = true
    return true
  }
  return false
}

function readBootstrapEscape(source: string, index: number, quote: BootstrapQuote): string | null {
  if (source[index] !== '\\' || quote === 'single') return null
  const next = source[index + 1]
  if (next === undefined) return null
  if (['\\', '"', "'"].includes(next)) return next
  return quote === null && /\s/.test(next) ? next : null
}

function consumeBootstrapCharacter(source: string, index: number, state: BootstrapTokenState): number {
  const character = source[index]!
  assertBootstrapCharacter(source, index, state.quote)
  if (consumeBootstrapQuote(character, state)) return index
  if (state.quote === null && /\s/.test(character)) {
    appendBootstrapToken(state)
    return index
  }
  const escaped = readBootstrapEscape(source, index, state.quote)
  state.token += escaped ?? character
  state.tokenStarted = true
  return escaped === null ? index : index + 1
}

export function parseBootstrapCommand(_source: string): ParsedBootstrapCommand {
  const source = _source.trim()
  if (source.length === 0) throw new Error('Bootstrap command must not be empty')
  const state: BootstrapTokenState = { tokens: [], token: '', tokenStarted: false, quote: null }
  for (let index = 0; index < source.length; index += 1) {
    index = consumeBootstrapCharacter(source, index, state)
  }
  if (state.quote !== null) throw new Error('Bootstrap command contains an unterminated quote')
  appendBootstrapToken(state)
  if (state.tokens.length === 0 || state.tokens[0]!.length === 0) {
    throw new Error('Bootstrap command must include an executable')
  }
  return { command: state.tokens[0]!, args: state.tokens.slice(1) }
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

interface BootstrapCommandContext {
  input: RunWorkspaceBootstrapInput
  index: number
  payload: ExecutablePayload
  workspaceRoot: string
  redactedCommand: string
  redactedArgs: string[]
  timeoutMs: number
  maxOutputBytes: number
  nowMs(): number
  artifacts: BootstrapArtifact[]
}

function bootstrapArtifactIdentity(context: BootstrapCommandContext) {
  return {
    schema_version: 1 as const,
    workspace_id: context.input.context.workspaceId,
    attempt_id: context.input.context.attemptId,
    index: context.index,
    command: context.redactedCommand,
    args: context.redactedArgs,
  }
}

async function recordBootstrapArtifact(context: BootstrapCommandContext, artifact: BootstrapArtifact): Promise<void> {
  await persistArtifact(context.input, artifact, context.index)
  context.artifacts.push(artifact)
}

function parseBootstrapPayload(source: string, index: number, workspaceRoot: string): ExecutablePayload {
  let parsed: ParsedBootstrapCommand
  try {
    parsed = parseBootstrapCommand(source)
  } catch (error) {
    throw new WorkspaceBootstrapError('Bootstrap command ' + index + ' is invalid', index, error)
  }
  return { command: parsed.command, args: parsed.args, cwd: workspaceRoot }
}

async function recordBootstrapPolicyFailure(context: BootstrapCommandContext, error: unknown): Promise<never> {
  const artifact: BootstrapArtifact = {
    ...bootstrapArtifactIdentity(context),
    stdout: '', stderr: '', duration_ms: 0, exit_code: null, status: 'policy_blocked',
    error_message: redactAndBound(
      error instanceof Error ? error.message : 'Policy evaluation failed',
      context.maxOutputBytes,
    ),
  }
  await recordBootstrapArtifact(context, artifact)
  throw new WorkspaceBootstrapError('Bootstrap policy evaluation failed for command ' + context.index, context.index, error)
}

async function recordBootstrapPolicyRejection(context: BootstrapCommandContext, policy: PolicyResult): Promise<never> {
  const artifact: BootstrapArtifact = {
    ...bootstrapArtifactIdentity(context),
    stdout: '', stderr: '', duration_ms: 0, exit_code: null, status: 'policy_blocked',
    error_message: redactAndBound(
      policy.reason ?? (policy.confirmation_required ? 'Policy confirmation required' : 'Policy denied command'),
      context.maxOutputBytes,
    ),
  }
  await recordBootstrapArtifact(context, artifact)
  throw new WorkspaceBootstrapError('Bootstrap policy blocked command ' + context.index, context.index)
}

async function evaluateBootstrapCommandPolicy(context: BootstrapCommandContext): Promise<void> {
  let policy: PolicyResult
  try {
    policy = context.input.evaluatePolicy(context.payload)
  } catch (error) {
    return await recordBootstrapPolicyFailure(context, error)
  }
  if (!policy.allowed || policy.confirmation_required) {
    await recordBootstrapPolicyRejection(context, policy)
  }
}

async function recordBootstrapExecutionError(
  context: BootstrapCommandContext,
  startedAt: number,
  error: unknown,
): Promise<never> {
  const { nowMs } = context
  const artifact: BootstrapArtifact = {
    ...bootstrapArtifactIdentity(context),
    stdout: '', stderr: '',
    duration_ms: Math.max(0, nowMs() - startedAt),
    exit_code: null, status: 'error',
    error_message: redactAndBound(
      error instanceof Error ? error.message : 'Bootstrap execution failed',
      context.maxOutputBytes,
    ),
  }
  await recordBootstrapArtifact(context, artifact)
  throw new WorkspaceBootstrapError('Bootstrap execution failed for command ' + context.index, context.index, error)
}

async function executeBootstrapCommand(context: BootstrapCommandContext): Promise<void> {
  const { nowMs } = context
  const startedAt = nowMs()
  let execution: BootstrapExecutionResult
  try {
    execution = await context.input.execute(context.payload, {
      cwd: context.workspaceRoot,
      shell: false,
      timeoutMs: context.timeoutMs,
      maxOutputBytes: context.maxOutputBytes,
    })
  } catch (error) {
    return await recordBootstrapExecutionError(context, startedAt, error)
  }
  const artifact: BootstrapArtifact = {
    ...bootstrapArtifactIdentity(context),
    stdout: redactAndBound(execution.stdout, context.maxOutputBytes),
    stderr: redactAndBound(execution.stderr, context.maxOutputBytes),
    duration_ms: Math.max(0, nowMs() - startedAt),
    exit_code: execution.exitCode,
    status: execution.exitCode === 0 ? 'success' : 'failed',
  }
  await recordBootstrapArtifact(context, artifact)
  if (execution.exitCode !== 0) {
    throw new WorkspaceBootstrapError(
      'Bootstrap command ' + context.index + ' exited with code ' + (execution.exitCode ?? 'unknown'),
      context.index,
    )
  }
}

export async function runWorkspaceBootstrap(
  input: RunWorkspaceBootstrapInput,
): Promise<BootstrapArtifact[]> {
  const workspaceRoot = await assertSafeBootstrapRoot(input)
  const timeoutMs = validateLimit(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'Bootstrap timeout')
  const maxOutputBytes = validateLimit(input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES, 'Bootstrap output limit')
  const nowMs = input.nowMs ?? Date.now
  const artifacts: BootstrapArtifact[] = []
  for (let index = 0; index < input.commands.length; index += 1) {
    const payload = parseBootstrapPayload(input.commands[index]!, index, workspaceRoot)
    const context: BootstrapCommandContext = {
      input, index, payload, workspaceRoot,
      redactedCommand: redactSecrets(payload.command),
      redactedArgs: redactArguments(payload.args),
      timeoutMs, maxOutputBytes, nowMs, artifacts,
    }
    await evaluateBootstrapCommandPolicy(context)
    await executeBootstrapCommand(context)
  }
  return artifacts
}

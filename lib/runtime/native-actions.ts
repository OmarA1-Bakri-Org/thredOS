import { access, mkdir, writeFile } from 'fs/promises'
import { basename, dirname, isAbsolute, join } from 'path'
import {
  buildConditionContext,
  evaluateRuntimeCondition,
  hydrateApolloApprovalRuntimeContext,
  getNestedRuntimeValue,
  readRuntimeContext,
  storeRuntimeContextValue,
  type RuntimeContext,
} from './context'
import type { Step, Sequence, ModelType } from '../sequence/schema'
import type { RunnerConfig, RunResult } from '../runner/wrapper'
import { assessCompletionResult, type CompletionAssessment } from '../runner/dispatch'
import type { dispatch } from '../runner/dispatch'

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000

const APOLLO_FILE_SOURCE_KEYS: Record<string, string> = {
  'icp-config.json': 'icp_config',
  'saved-contacts.json': 'saved_contacts',
  'discovered-prospects.json': 'discovered_prospects',
  'qualified-segment.json': 'qualified_segment',
  'enriched-segment.json': 'enriched_segment',
}

export interface NativeActionRuntime {
  dispatch: typeof dispatch
  runStep: (config: RunnerConfig) => Promise<RunResult>
  runComposioTool?: (input: {
    toolSlug: string
    arguments: Record<string, unknown>
    timeoutMs?: number
  }) => Promise<unknown>
}

export class AbortWorkflowError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AbortWorkflowError'
  }
}

function normalizeActionType(type: unknown): string {
  return type === 'rube_tool' ? 'composio_tool' : String(type ?? '')
}

function normalizeResultStatus(result: RunResult): 'success' | 'failed' {
  return result.exitCode === 0 ? 'success' : 'failed'
}

function normalizeCompletionStatus(completion: CompletionAssessment): 'success' | 'needs_review' | 'failed' {
  if (completion.status === 'DONE') return 'success'
  if (completion.status === 'NEEDS_REVIEW') return 'needs_review'
  return 'failed'
}

function buildSubAgentPrompt(taskPrompt: string): string {
  return [
    'You are executing a thredOS native sub_agent action.',
    'Complete the requested work directly.',
    'Exit 0 only if you actually completed the requested work and produced the requested result.',
    'If you are blocked, refused, missing permissions, or required tools are unavailable, explain the blocker and exit 42 instead of 0.',
    '',
    '## Task',
    taskPrompt,
  ].join('\n')
}

function resolveActionTimeout(action: Record<string, unknown>, step: Step): number {
  return typeof action.timeout_ms === 'number'
    ? action.timeout_ms
    : (step.timeout_ms || DEFAULT_TIMEOUT_MS)
}

function resolveActionId(action: Record<string, unknown>, fallback: string): string {
  return typeof action.id === 'string' && action.id.length > 0 ? action.id : fallback
}

function resolveFailurePolicy(action: Record<string, unknown>): string {
  return typeof action.on_failure === 'string' ? action.on_failure : 'abort_step'
}

async function handleActionFailure(action: Record<string, unknown>, message: string): Promise<void> {
  const policy = resolveFailurePolicy(action)
  if (policy === 'warn' || policy === 'skip') {
    console.warn(message)
    return
  }
  if (policy === 'abort_workflow') {
    throw new AbortWorkflowError(message)
  }
  throw new Error(message)
}

async function storeActionOutput(basePath: string, action: Record<string, unknown>, value: unknown): Promise<void> {
  if (typeof action.output_key === 'string' && action.output_key.length > 0) {
    await storeRuntimeContextValue(basePath, action.output_key, value)
  }
}

export async function renderRuntimeContextTemplate(
  basePath: string,
  template: string,
  runtimeContext?: RuntimeContext,
): Promise<string> {
  const hydratedContext = await hydrateApolloApprovalRuntimeContext(basePath, runtimeContext ?? await readRuntimeContext(basePath))

  return template.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (match, path: string) => {
    const value = getNestedRuntimeValue(hydratedContext, path)
    if (value === undefined) return match
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return String(value)
    }
    try {
      return JSON.stringify(value)
    } catch {
      return match
    }
  })
}

async function executeCliAction(
  basePath: string,
  step: Step,
  runId: string,
  runtime: NativeActionRuntime,
  action: Record<string, unknown>,
): Promise<void> {
  const config = (action.config ?? {}) as Record<string, unknown>
  const command = typeof config.command === 'string' ? config.command.trim() : ''
  const actionId = resolveActionId(action, 'cli')

  if (!command) {
    throw new Error(`CLI action '${actionId}' is missing config.command`)
  }

  const result = await runtime.runStep({
    stepId: `${step.id}::${actionId}`,
    runId,
    command: 'sh',
    args: ['-lc', command],
    cwd: step.cwd || basePath,
    timeout: resolveActionTimeout(action, step),
  })

  const output = {
    command,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    status: normalizeResultStatus(result),
  }

  await storeActionOutput(basePath, action, output)

  if (result.exitCode !== 0) {
    await handleActionFailure(action, `CLI action '${actionId}' failed with exit code ${result.exitCode}: ${result.stderr.trim() || result.stdout.trim() || command}`)
  }
}

function resolveWriteTarget(basePath: string, filePath: string): string {
  return isAbsolute(filePath) ? filePath : join(basePath, filePath)
}

function resolveWriteSourceKey(action: Record<string, unknown>, targetPath: string, runtimeContext: RuntimeContext): string | null {
  const config = (action.config ?? {}) as Record<string, unknown>
  const explicitSourceKey = typeof config.source_key === 'string' && config.source_key.length > 0
    ? config.source_key
    : null
  if (explicitSourceKey) return explicitSourceKey

  const inferredFromFileName = APOLLO_FILE_SOURCE_KEYS[basename(targetPath)]
  if (inferredFromFileName) return inferredFromFileName

  if (typeof action.output_key === 'string' && getNestedRuntimeValue(runtimeContext, action.output_key) !== undefined) {
    return action.output_key
  }

  return null
}

function stringifyWriteContent(value: unknown): string {
  if (typeof value === 'string') return value
  return `${JSON.stringify(value, null, 2)}\n`
}

async function resolveWriteContent(basePath: string, action: Record<string, unknown>, targetPath: string): Promise<{ content: string; sourceKey: string | null }> {
  const config = (action.config ?? {}) as Record<string, unknown>
  const runtimeContext = await readRuntimeContext(basePath)
  const hydratedContext = await hydrateApolloApprovalRuntimeContext(basePath, runtimeContext)
  const sourceKey = resolveWriteSourceKey(action, targetPath, hydratedContext)

  if (sourceKey) {
    const runtimeValue = getNestedRuntimeValue(hydratedContext, sourceKey)
    if (runtimeValue !== undefined) {
      return { content: stringifyWriteContent(runtimeValue), sourceKey }
    }
  }

  if (typeof config.content === 'string') {
    return { content: await renderRuntimeContextTemplate(basePath, config.content, hydratedContext), sourceKey }
  }

  throw new Error(`write_file action could not resolve content for '${targetPath}'`)
}

async function executeWriteFileAction(basePath: string, action: Record<string, unknown>): Promise<void> {
  const config = (action.config ?? {}) as Record<string, unknown>
  const rawFilePath = typeof config.file_path === 'string' ? config.file_path.trim() : ''
  const actionId = resolveActionId(action, 'write_file')

  if (!rawFilePath) {
    throw new Error(`write_file action '${actionId}' is missing config.file_path`)
  }

  const targetPath = resolveWriteTarget(basePath, rawFilePath)
  const { content, sourceKey } = await resolveWriteContent(basePath, action, targetPath)
  await mkdir(dirname(targetPath), { recursive: true })
  await writeFile(targetPath, content, 'utf-8')

  if (APOLLO_FILE_SOURCE_KEYS[basename(targetPath)]) {
    await storeRuntimeContextValue(basePath, 'apollo_artifact_dir', dirname(targetPath))
  }

  await storeActionOutput(basePath, action, {
    path: targetPath,
    bytes: Buffer.byteLength(content, 'utf-8'),
    sourceKey,
    status: 'written',
  })
}

async function executeSubAgentAction(
  basePath: string,
  step: Step,
  runId: string,
  runtime: NativeActionRuntime,
  action: Record<string, unknown>,
): Promise<void> {
  const config = (action.config ?? {}) as Record<string, unknown>
  const prompt = typeof config.prompt === 'string' ? config.prompt.trim() : ''
  const actionId = resolveActionId(action, 'sub_agent')

  if (!prompt) {
    throw new Error(`sub_agent action '${actionId}' is missing config.prompt`)
  }

  const compiledPrompt = buildSubAgentPrompt(await renderRuntimeContextTemplate(basePath, prompt))
  const resolvedModel = typeof config.model === 'string' && config.model.length > 0
    ? config.model
    : (step.model === 'shell' ? 'claude-code' : step.model)
  const model = resolvedModel as ModelType
  const nestedStepId = `${step.id}::${actionId}`
  const runnerConfig = await runtime.dispatch(model, {
    stepId: nestedStepId,
    runId,
    compiledPrompt,
    cwd: step.cwd || basePath,
    timeout: resolveActionTimeout(action, step),
  })
  const result = await runtime.runStep(runnerConfig)
  const completion = assessCompletionResult(result)
  const output = {
    actionId,
    model,
    subagentType: typeof config.subagent_type === 'string' ? config.subagent_type : null,
    prompt: compiledPrompt,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    status: normalizeCompletionStatus(completion),
    reviewReasons: completion.reasons,
  }

  await storeActionOutput(basePath, action, output)

  if (completion.status !== 'DONE') {
    const failureDetail = result.stderr.trim() || result.stdout.trim() || prompt
    const reasonSuffix = completion.reasons.length > 0 ? ` [${completion.reasons.join(', ')}]` : ''
    await handleActionFailure(action, `sub_agent action '${actionId}' did not produce completion evidence${reasonSuffix}: ${failureDetail}`)
  }
}

async function executeComposioCompatibleAction(
  basePath: string,
  step: Step,
  runtime: NativeActionRuntime,
  action: Record<string, unknown>,
): Promise<void> {
  const config = (action.config ?? {}) as Record<string, unknown>
  const toolSlug = typeof config.tool_slug === 'string' ? config.tool_slug : ''
  const input = config.arguments
  const actionArgs = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
  const actionId = resolveActionId(action, toolSlug || 'composio_tool')

  if (!toolSlug) {
    throw new Error(`Composio action '${actionId}' is missing config.tool_slug`)
  }

  try {
    const runComposioTool = runtime.runComposioTool
    if (!runComposioTool) {
      throw new Error(`Composio executor unavailable for action '${actionId}'`)
    }

    const result = await runComposioTool({
      toolSlug,
      arguments: actionArgs,
      timeoutMs: resolveActionTimeout(action, step),
    })

    await storeActionOutput(basePath, action, result ?? null)
  } catch (error) {
    await handleActionFailure(action, `Composio action '${actionId}' failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export interface SelectedStepEvidenceAssessment {
  outputSchemaValid: boolean
  completionContractSatisfied: boolean
  reasons: string[]
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function collectExecutedActions(
  basePath: string,
  sequence: Sequence,
  actions: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const selected: Array<Record<string, unknown>> = []

  for (const action of actions) {
    if (action.type === 'conditional') {
      const config = (action.config ?? {}) as Record<string, unknown>
      const branchContext = buildConditionContext(sequence, await readRuntimeContext(basePath))
      const branchActions = evaluateRuntimeCondition(String(config.condition ?? ''), branchContext)
        ? config.if_true
        : config.if_false
      const nestedActions = Array.isArray(branchActions)
        ? branchActions.filter((candidate): candidate is Record<string, unknown> => !!candidate && typeof candidate === 'object')
        : []
      selected.push(...await collectExecutedActions(basePath, sequence, nestedActions))
      continue
    }

    selected.push(action)
  }

  return selected
}

export async function assessSelectedStepEvidence(
  basePath: string,
  sequence: Sequence,
  step: Step,
): Promise<SelectedStepEvidenceAssessment> {
  if (!step.output_contract_ref && !step.completion_contract) {
    return { outputSchemaValid: true, completionContractSatisfied: true, reasons: [] }
  }

  const runtimeContext = await readRuntimeContext(basePath)
  const actions = await collectExecutedActions(
    basePath,
    sequence,
    ((step.actions ?? []) as Array<Record<string, unknown>>).filter(action => !!action && typeof action === 'object'),
  )
  const reasons = new Set<string>()

  for (const action of actions) {
    const actionType = normalizeActionType(action.type)
    const outputKey = typeof action.output_key === 'string' && action.output_key.length > 0
      ? action.output_key
      : null
    const evidenceValue = outputKey ? getNestedRuntimeValue(runtimeContext, outputKey) : undefined

    if (actionType === 'write_file') {
      const config = (action.config ?? {}) as Record<string, unknown>
      const rawFilePath = typeof config.file_path === 'string' ? config.file_path.trim() : ''
      if (!rawFilePath) continue

      const evidencePath = evidenceValue && typeof evidenceValue === 'object' && !Array.isArray(evidenceValue)
        && typeof (evidenceValue as Record<string, unknown>).path === 'string'
        ? (evidenceValue as Record<string, unknown>).path as string
        : resolveWriteTarget(basePath, rawFilePath)

      if (!await pathExists(evidencePath)) {
        reasons.add('EXPLICIT_ARTIFACT_PATH_MISSING')
      }

      if (outputKey) {
        const status = evidenceValue && typeof evidenceValue === 'object' && !Array.isArray(evidenceValue)
          ? (evidenceValue as Record<string, unknown>).status
          : undefined
        if (status !== 'written') {
          reasons.add('EXPLICIT_ACTION_RESULT_MISSING')
        }
      }
      continue
    }

    if (actionType === 'composio_tool') {
      if (outputKey && evidenceValue == null) {
        reasons.add('EXPLICIT_OUTPUT_KEY_MISSING')
      }
      continue
    }

    if (actionType === 'sub_agent') {
      if (!outputKey) continue
      const status = evidenceValue && typeof evidenceValue === 'object' && !Array.isArray(evidenceValue)
        ? (evidenceValue as Record<string, unknown>).status
        : undefined
      if (status !== 'success') {
        reasons.add('EXPLICIT_ACTION_RESULT_MISSING')
      }
    }
  }

  const passed = reasons.size === 0
  return {
    outputSchemaValid: passed,
    completionContractSatisfied: passed,
    reasons: Array.from(reasons),
  }
}

export async function executeNativeOperationalAction(
  basePath: string,
  _sequence: Sequence,
  step: Step,
  runId: string,
  runtime: NativeActionRuntime,
  action: Record<string, unknown>,
): Promise<boolean> {
  const actionType = normalizeActionType(action.type)

  if (actionType === 'cli') {
    await executeCliAction(basePath, step, runId, runtime, action)
    return true
  }

  if (actionType === 'write_file') {
    await executeWriteFileAction(basePath, action)
    return true
  }

  if (actionType === 'sub_agent') {
    await executeSubAgentAction(basePath, step, runId, runtime, action)
    return true
  }

  if (actionType === 'composio_tool') {
    await executeComposioCompatibleAction(basePath, step, runtime, action)
    return true
  }

  return false
}

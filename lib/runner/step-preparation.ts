import { access, readFile } from 'fs/promises'
import { join } from 'path'
import type { InputManifestJson } from './artifacts'
import { compilePrompt } from './prompt-compiler'
import type { Sequence, Step } from '../sequence/schema'

export interface PrepareStepPromptOptions {
  stepId: string
  step: Step
  sequence: Sequence
  basePath: string
  maxTokens: number
  runtimeEventLogPath?: string
  runtimeEventEmitterCommand?: string
}

export interface PreparedStepPrompt {
  promptPath: string
  promptRef: string
  rawPrompt: string
  promptWithActions: string
  promptForDispatch: string
}

export function getStepPromptRef(step: Step): string {
  return step.prompt_ref?.path ?? resolveStepPromptFile(step)
}

export function resolveStepPromptFile(step: Step): string {
  return typeof step.prompt_file === 'string' && step.prompt_file.length > 0
    ? step.prompt_file
    : `.threados/prompts/${step.id}.md`
}

export function resolveStepPromptPath(basePath: string, step: Step): string {
  return join(basePath, resolveStepPromptFile(step))
}

export async function validateStepPromptExists(basePath: string, step: Step): Promise<boolean> {
  try {
    await access(resolveStepPromptPath(basePath, step))
    return true
  } catch {
    return false
  }
}

export async function readStepPrompt(basePath: string, step: Step): Promise<string> {
  return readFile(resolveStepPromptPath(basePath, step), 'utf-8')
}

export function renderStepActionContract(step: Step): string {
  const actions = (step as Step & { actions?: unknown[] }).actions
  if (!Array.isArray(actions) || actions.length === 0) return ''
  return `\n\n## THREADOS ACTION CONTRACT\n${JSON.stringify(actions, null, 2)}\n`
}

export function appendStepActionContract(rawPrompt: string, step: Step): string {
  return `${rawPrompt}${renderStepActionContract(step)}`
}

export async function prepareStepPromptForDispatch(options: PrepareStepPromptOptions): Promise<PreparedStepPrompt> {
  const rawPrompt = await readStepPrompt(options.basePath, options.step)
  const promptWithActions = appendStepActionContract(rawPrompt, options.step)
  const promptForDispatch = options.step.model === 'shell'
    ? promptWithActions
    : await compilePrompt({
        stepId: options.stepId,
        step: options.step,
        rawPrompt: promptWithActions,
        sequence: options.sequence,
        basePath: options.basePath,
        maxTokens: options.maxTokens,
        runtimeEventLogPath: options.runtimeEventLogPath,
        runtimeEventEmitterCommand: options.runtimeEventEmitterCommand,
      })

  return {
    promptPath: resolveStepPromptPath(options.basePath, options.step),
    promptRef: getStepPromptRef(options.step),
    rawPrompt,
    promptWithActions,
    promptForDispatch,
  }
}

export function makeStepInputManifest(step: Step, runId: string, surfaceId: string, createdAt: string): InputManifestJson {
  return {
    stepId: step.id,
    runId,
    surfaceId,
    promptRef: getStepPromptRef(step),
    dependsOn: step.depends_on,
    inputContractRef: step.input_contract_ref ?? null,
    createdAt,
  }
}

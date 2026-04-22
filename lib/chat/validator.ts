import { readSequence, writeSequence } from '../sequence/parser'
import { PolicyEngine } from '../policy/engine'
import * as audit from '../audit/logger'
import YAML from 'yaml'
import { StepSchema, StepTypeSchema, ModelTypeSchema, StepStatusSchema, FailPolicySchema, type Sequence } from '../sequence/schema'
import { readThreadSurfaceState, withThreadSurfaceStateRevision, writeThreadSurfaceState } from '@/lib/thread-surfaces/repository'
import { materializeStepSurface, removeStepSurface } from '@/lib/thread-surfaces/materializer'

export interface ProposedAction {
  command: string
  args: Record<string, string | string[] | boolean | number | undefined>
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export interface DryRunResult {
  valid: boolean
  diff: string
  errors: string[]
}

export interface ApplyResult {
  success: boolean
  results: Array<{ action?: string; status?: string; error?: string }>
}

const VALID_COMMANDS = [
  'step add', 'step remove', 'step update',
  'run', 'stop', 'restart',
  'gate approve', 'gate block',
  'dep add', 'dep remove',
  'group create', 'fusion create',
]

type ValidatorFn = (action: ProposedAction, errors: string[]) => void

function requireFields(command: string, fields: string[]): ValidatorFn {
  return (action, errors) => {
    for (const field of fields) {
      if (!action.args[field]) errors.push(`${command} requires ${field}`)
    }
  }
}

const commandValidators: Record<string, ValidatorFn> = {
  'step add': requireFields('step add', ['id', 'name', 'type', 'model', 'prompt_file']),
  'step remove': requireFields('step remove', ['id']),
  'step update': requireFields('step update', ['id']),
  'dep add': requireFields('dep add', ['from', 'to']),
  'dep remove': requireFields('dep remove', ['from', 'to']),
  'restart': requireFields('restart', ['step_id']),
  'stop': requireFields('stop', ['step_id']),
  'gate approve': (action, errors) => { if (!action.args.id) errors.push('gate approve requires id') },
  'gate block': (action, errors) => { if (!action.args.id) errors.push('gate block requires id') },
  'group create': requireFields('group create', ['id', 'step_ids']),
  'fusion create': requireFields('fusion create', ['candidate_ids', 'synth_id']),
}

/** Allowed fields for step update to prevent arbitrary field injection */
const ALLOWED_UPDATE_FIELDS = new Set([
  'id', 'name', 'type', 'model', 'prompt_file', 'depends_on',
  'status', 'cwd', 'group_id', 'fanout', 'fusion_candidates',
  'fusion_synth', 'watchdog_for', 'orchestrator', 'timeout_ms', 'fail_policy',
])

export class ActionValidator {
  constructor(private basePath: string) {}

  /**
   * Validate that actions reference valid seqctl commands
   */
  async validate(actions: ProposedAction[]): Promise<ValidationResult> {
    const errors: string[] = []

    for (const action of actions) {
      if (!VALID_COMMANDS.includes(action.command)) {
        errors.push(`Unknown command: ${action.command}`)
        continue
      }

      const validator = commandValidators[action.command]
      if (validator) {
        validator(action, errors)
      }
    }

    return { valid: errors.length === 0, errors }
  }

  /**
   * Execute actions against a copy of the sequence and compute a diff
   */
  async dryRun(actions: ProposedAction[]): Promise<DryRunResult> {
    const validation = await this.validate(actions)
    if (!validation.valid) {
      return { valid: false, diff: '', errors: validation.errors }
    }

    try {
      const original = await readSequence(this.basePath)
      const originalYaml = YAML.stringify(original, { indent: 2 })

      // Apply actions to a copy
      const modified = structuredClone(original)
      const errors: string[] = []

      for (const action of actions) {
        const err = applyAction(modified, action)
        if (err) errors.push(err)
      }

      if (errors.length > 0) {
        return { valid: false, diff: '', errors }
      }

      const modifiedYaml = YAML.stringify(modified, { indent: 2 })
      const diff = computeUnifiedDiff(originalYaml, modifiedYaml)

      return { valid: true, diff, errors: [] }
    } catch (error) {
      return { valid: false, diff: '', errors: [(error as Error).message] }
    }
  }

  /**
   * Apply actions for real with policy checks and durable local-state writes.
   */
  async apply(actions: ProposedAction[]): Promise<ApplyResult> {
    const validation = await this.validate(actions)
    if (!validation.valid) {
      return { success: false, results: validation.errors.map(e => ({ error: e })) }
    }

    const policy = await PolicyEngine.load(this.basePath)
    const results: Array<{ action?: string; status?: string; error?: string }> = []

    try {
      const sequence = await readSequence(this.basePath)
      const sequenceSnapshot = structuredClone(sequence)
      const currentSurfaceState = await readThreadSurfaceState(this.basePath)
      const surfaceStateSnapshot = structuredClone(currentSurfaceState)
      let nextSurfaceState = structuredClone(currentSurfaceState)
      let surfaceStateDirty = false
      const appliedActions: ProposedAction[] = []

      for (const action of actions) {
        const policyResult = policy.validate({
          type: 'run_command',
          command: action.command,
        })

        if (!policyResult.allowed) {
          results.push({ action: action.command, error: policyResult.reason })
          continue
        }

        const err = applyAction(sequence, action)
        if (err) {
          results.push({ action: action.command, error: err })
          continue
        }

        if (action.command === 'step add' && action.args.id) {
          nextSurfaceState = materializeStepSurface(
            nextSurfaceState,
            String(action.args.id),
            String(action.args.name || action.args.id),
            sequence.name,
            new Date().toISOString(),
          )
          surfaceStateDirty = true
        }

        if (action.command === 'step remove' && action.args.id) {
          nextSurfaceState = removeStepSurface(nextSurfaceState, String(action.args.id))
          surfaceStateDirty = true
        }

        appliedActions.push(action)
        results.push({ action: action.command, status: 'applied' })
      }

      await writeSequence(this.basePath, sequence)

      if (surfaceStateDirty) {
        try {
          await writeThreadSurfaceState(
            this.basePath,
            withThreadSurfaceStateRevision(currentSurfaceState, nextSurfaceState),
          )
        } catch (error) {
          await writeSequence(this.basePath, structuredClone(sequenceSnapshot)).catch(() => {})
          await writeThreadSurfaceState(this.basePath, structuredClone(surfaceStateSnapshot)).catch(() => {})
          throw error
        }
      }

      for (const action of appliedActions) {
        await audit.log(this.basePath, {
          timestamp: new Date().toISOString(),
          actor: 'chat-orchestrator',
          action: action.command,
          target: String(action.args.id || action.args.step_id || 'sequence'),
          payload: action.args,
          result: 'applied',
        }).catch(() => {})
      }

      return { success: true, results }
    } catch (error) {
      return { success: false, results: [{ error: (error as Error).message }] }
    }
  }
}

const BOOLEAN_LOOKUP: Record<string, boolean> = {
  'true': true,
  'false': false,
}

/**
 * Parse a value that should be boolean but may arrive as a string.
 * Returns the boolean value, or null if the value cannot be interpreted as boolean.
 */
function parseBooleanField(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    return BOOLEAN_LOOKUP[value.trim().toLowerCase()] ?? null
  }
  return null
}

/** Validate allowed fields and apply enum/schema checks for step update */
function applyStepUpdate(
  step: import('../sequence/schema').Step,
  updates: Record<string, string | string[] | boolean | number | undefined>
): string | null {
  for (const key of Object.keys(updates)) {
    if (!ALLOWED_UPDATE_FIELDS.has(key)) {
      return `Invalid update field: ${key}`
    }
  }

  // Validate enum fields
  const enumError = validateEnumUpdates(step, updates)
  if (enumError) return enumError

  // Apply simple string fields
  if (updates.name !== undefined) step.name = String(updates.name)
  if (updates.prompt_file !== undefined) step.prompt_file = String(updates.prompt_file)
  if (updates.cwd !== undefined) step.cwd = String(updates.cwd)
  if (updates.depends_on !== undefined && Array.isArray(updates.depends_on)) {
    step.depends_on = updates.depends_on.map(String)
  }
  if (updates.group_id !== undefined) step.group_id = String(updates.group_id)
  if (updates.watchdog_for !== undefined) step.watchdog_for = String(updates.watchdog_for)
  if (updates.orchestrator !== undefined) step.orchestrator = String(updates.orchestrator)

  // Apply numeric fields
  const numericError = applyNumericUpdates(step, updates)
  if (numericError) return numericError

  // Apply boolean fields
  const booleanError = applyBooleanUpdates(step, updates)
  if (booleanError) return booleanError

  // Apply fail_policy
  if (updates.fail_policy !== undefined) {
    const policyResult = FailPolicySchema.safeParse(updates.fail_policy)
    if (!policyResult.success) return `Invalid fail_policy: ${updates.fail_policy}`
    step.fail_policy = policyResult.data
  }

  return null
}

function validateEnumUpdates(
  step: import('../sequence/schema').Step,
  updates: Record<string, string | string[] | boolean | number | undefined>
): string | null {
  if (updates.type !== undefined) {
    const typeResult = StepTypeSchema.safeParse(updates.type)
    if (!typeResult.success) return `Invalid type: ${updates.type}`
    step.type = typeResult.data
    step.kind = typeResult.data
  }
  if (updates.model !== undefined) {
    const modelResult = ModelTypeSchema.safeParse(updates.model)
    if (!modelResult.success) return `Invalid model: ${updates.model}`
    step.model = modelResult.data
  }
  if (updates.status !== undefined) {
    const statusResult = StepStatusSchema.safeParse(updates.status)
    if (!statusResult.success) return `Invalid status: ${updates.status}`
    step.status = statusResult.data
  }
  return null
}

function applyNumericUpdates(
  step: import('../sequence/schema').Step,
  updates: Record<string, string | string[] | boolean | number | undefined>
): string | null {
  if (updates.fanout !== undefined) {
    const fanout = Number(updates.fanout)
    if (isNaN(fanout)) return `Invalid fanout: must be a number`
    step.fanout = fanout
  }
  if (updates.timeout_ms !== undefined) {
    const timeout = Number(updates.timeout_ms)
    if (isNaN(timeout)) return `Invalid timeout_ms: must be a number`
    step.timeout_ms = timeout
  }
  return null
}

function applyBooleanUpdates(
  step: import('../sequence/schema').Step,
  updates: Record<string, string | string[] | boolean | number | undefined>
): string | null {
  if (updates.fusion_candidates !== undefined) {
    const parsed = parseBooleanField(updates.fusion_candidates)
    if (parsed === null) return `Invalid fusion_candidates: expected boolean or "true"/"false"`
    step.fusion_candidates = parsed
  }
  if (updates.fusion_synth !== undefined) {
    const parsed = parseBooleanField(updates.fusion_synth)
    if (parsed === null) return `Invalid fusion_synth: expected boolean or "true"/"false"`
    step.fusion_synth = parsed
  }
  return null
}

function applyStepAdd(seq: Sequence, action: ProposedAction): string | null {
  if (seq.steps.find(s => s.id === action.args.id)) {
    return `Step ${action.args.id} already exists`
  }
  const newStep = {
    id: action.args.id,
    name: action.args.name,
    type: action.args.type || 'base',
    model: action.args.model || 'claude-code',
    prompt_file: action.args.prompt_file,
    depends_on: action.args.depends_on || [],
    status: 'READY',
  }
  const parsed = StepSchema.safeParse(newStep)
  if (!parsed.success) {
    return `Invalid step: ${parsed.error.issues.map(i => i.message).join(', ')}`
  }
  seq.steps.push(parsed.data)
  return null
}

function applyStepRemove(seq: Sequence, action: ProposedAction): string | null {
  const idx = seq.steps.findIndex(s => s.id === action.args.id)
  if (idx === -1) return `Step ${action.args.id} not found`
  seq.steps.splice(idx, 1)
  for (const s of seq.steps) {
    s.depends_on = s.depends_on.filter(d => d !== action.args.id)
  }
  return null
}

function applyDepAdd(seq: Sequence, action: ProposedAction): string | null {
  const step = seq.steps.find(s => s.id === action.args.from)
  if (!step) return `Step ${action.args.from} not found`
  if (!step.depends_on.includes(String(action.args.to))) {
    step.depends_on.push(String(action.args.to))
  }
  return null
}

function applyDepRemove(seq: Sequence, action: ProposedAction): string | null {
  const step = seq.steps.find(s => s.id === action.args.from)
  if (!step) return `Step ${action.args.from} not found`
  step.depends_on = step.depends_on.filter(d => d !== action.args.to)
  return null
}

function applyGateStatus(seq: Sequence, action: ProposedAction, status: 'APPROVED' | 'BLOCKED'): string | null {
  const gate = seq.gates.find(g => g.id === action.args.id)
  if (!gate) return `Gate ${action.args.id} not found`
  gate.status = status
  return null
}

type ActionApplier = (seq: Sequence, action: ProposedAction) => string | null

const actionAppliers: Record<string, ActionApplier> = {
  'step add': applyStepAdd,
  'step remove': applyStepRemove,
  'step update': (seq, action) => {
    const step = seq.steps.find(s => s.id === action.args.id)
    if (!step) return `Step ${action.args.id} not found`
    const { id: _id, ...updates } = action.args
    return applyStepUpdate(step, updates)
  },
  'dep add': applyDepAdd,
  'dep remove': applyDepRemove,
  'gate approve': (seq, action) => {
    const gate = seq.gates.find(g => g.id === action.args.id)
    if (!gate) return `Gate ${action.args.id} not found`
    if (gate.required_review && gate.acceptance_conditions?.length) {
      if (!action.args.acknowledged_conditions) {
        return 'Gate requires review of acceptance conditions before approval'
      }
    }
    gate.status = 'APPROVED'
    return null
  },
  'gate block': (seq, action) => applyGateStatus(seq, action, 'BLOCKED'),
  'run': () => null,
  'stop': (seq, action) => {
    const stepId = String(action.args.step_id || '')
    if (!stepId) return 'stop requires step_id'
    const step = seq.steps.find(s => s.id === stepId)
    if (!step) return `Step ${stepId} not found`
    step.status = 'FAILED'
    return null
  },
  'restart': (seq, action) => {
    const stepId = String(action.args.step_id)
    const step = seq.steps.find(s => s.id === stepId)
    if (!step) return `Step ${stepId} not found`
    step.status = 'RUNNING'
    return null
  },
  'group create': (seq, action) => {
    const groupId = String(action.args.id || '')
    const stepIds = action.args.step_ids as string[] | undefined
    if (!groupId) return 'group create requires id'
    if (!Array.isArray(stepIds) || stepIds.length < 2) return 'group create requires at least 2 step_ids'
    // Validate ALL step_ids exist before mutating any
    for (const sid of stepIds) {
      if (!seq.steps.find(s => s.id === String(sid))) return `Step ${sid} not found`
    }
    for (const sid of stepIds) {
      const step = seq.steps.find(s => s.id === String(sid))!
      step.group_id = groupId
      step.type = 'p'
      step.kind = 'p'
    }
    return null
  },
  'fusion create': (seq, action) => {
    const candidateIds = action.args.candidate_ids as string[] | undefined
    const synthId = String(action.args.synth_id || '')
    if (!Array.isArray(candidateIds) || candidateIds.length < 2) return 'fusion create requires at least 2 candidate_ids'
    if (!synthId) return 'fusion create requires synth_id'
    // Validate ALL candidate_ids exist before mutating any
    for (const cid of candidateIds) {
      if (!seq.steps.find(s => s.id === String(cid))) return `Step ${cid} not found`
    }
    for (const cid of candidateIds) {
      const step = seq.steps.find(s => s.id === String(cid))!
      step.fusion_candidates = true
      step.type = 'f'
      step.kind = 'f'
    }
    if (!seq.steps.some(s => s.id === synthId)) {
      const synthStep = StepSchema.safeParse({
        id: synthId, name: `Fusion synth: ${synthId}`, kind: 'f', type: 'f',
        model: 'claude-code', prompt_file: `.threados/prompts/${synthId}.md`,
        depends_on: candidateIds.map(String), status: 'READY', fusion_synth: true,
      })
      if (!synthStep.success) return `Invalid synth step: ${synthStep.error.issues.map(i => i.message).join(', ')}`
      seq.steps.push(synthStep.data)
    } else {
      const existing = seq.steps.find(s => s.id === synthId)!
      existing.fusion_synth = true
      existing.type = 'f'
      existing.kind = 'f'
    }
    return null
  },
}

/**
 * Apply a single action to a sequence object (mutates in place).
 * Returns error string or null on success.
 */
function applyAction(seq: Sequence, action: ProposedAction): string | null {
  const applier = actionAppliers[action.command]
  if (!applier) return `Unknown command: ${action.command}`
  return applier(seq, action)
}

/**
 * Simple unified diff between two strings
 */
function computeUnifiedDiff(a: string, b: string): string {
  const aLines = a.split('\n')
  const bLines = b.split('\n')
  const lines: string[] = ['--- original', '+++ modified']

  const maxLen = Math.max(aLines.length, bLines.length)
  for (let i = 0; i < maxLen; i++) {
    const aLine = aLines[i]
    const bLine = bLines[i]
    if (aLine === bLine) {
      lines.push(` ${aLine ?? ''}`)
    } else {
      if (aLine !== undefined) lines.push(`-${aLine}`)
      if (bLine !== undefined) lines.push(`+${bLine}`)
    }
  }

  return lines.join('\n')
}

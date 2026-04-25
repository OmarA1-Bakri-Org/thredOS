import { createHash } from 'crypto'
import { z } from 'zod'

export const StrategyOptionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/).min(1),
  label: z.string().min(1),
  applies_to: z.array(z.string().regex(/^[a-z0-9-]+$/)).default([]),
  selects_steps: z.array(z.string().regex(/^[a-z0-9-]+$/)).default([]),
  suppresses_steps: z.array(z.string().regex(/^[a-z0-9-]+$/)).default([]),
  requires_approval: z.boolean().default(false),
})
export type StrategyOption = z.infer<typeof StrategyOptionSchema>

export const ReplanPolicySchema = z.object({
  enabled: z.boolean(),
  triggers: z.array(z.enum(['empty_artifact', 'sparse_results'])).default([]),
}).optional()
export type ReplanPolicy = z.infer<typeof ReplanPolicySchema>

export const StepStatusSchema = z.enum([
  'READY', 'RUNNING', 'NEEDS_REVIEW', 'DONE', 'FAILED', 'BLOCKED', 'SKIPPED',
])
export type StepStatus = z.infer<typeof StepStatusSchema>

export const StepKindSchema = z.enum(['base', 'p', 'c', 'f', 'b', 'l'])
export type StepKind = z.infer<typeof StepKindSchema>
export const StepTypeSchema = StepKindSchema
export type StepType = StepKind

export const KNOWN_MODELS = ['claude-code', 'codex', 'gemini', 'shell'] as const

export const ModelTypeSchema = z.string().min(1, { message: 'Model identifier is required' })
export type ModelType = z.infer<typeof ModelTypeSchema>

export const FailPolicySchema = z.enum(['stop-all', 'continue', 'retry'])
export type FailPolicy = z.infer<typeof FailPolicySchema>

export const SkillRefSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive().default(1),
  path: z.string().optional(),
  capabilities: z.array(z.string()).default([]),
})
export type SkillRef = z.infer<typeof SkillRefSchema>

export const PromptRefSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive().default(1),
  path: z.string().optional(),
})
export type PromptRef = z.infer<typeof PromptRefSchema>

export const LlmSettingsSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  max_tokens: z.number().int().positive().optional(),
}).optional()
export type LlmSettings = z.infer<typeof LlmSettingsSchema>

export const DependencyEdgeSchema = z.object({
  step_id: z.string().min(1),
  dep_id: z.string().min(1),
})
export type DependencyEdge = z.infer<typeof DependencyEdgeSchema>

function derivePromptRef(raw: Record<string, unknown>, stepId: string, promptFile: string): PromptRef {
  const existing = (raw.prompt_ref ?? raw.promptRef) as Record<string, unknown> | undefined
  return PromptRefSchema.parse({
    id: typeof existing?.id === 'string' && existing.id.length > 0 ? existing.id : stepId,
    version: typeof existing?.version === 'number' ? existing.version : 1,
    path: typeof existing?.path === 'string' ? existing.path : promptFile,
  })
}

function coerceStep(raw: unknown): Record<string, unknown> {
  const input = (raw ?? {}) as Record<string, unknown>
  const id = String(input.id ?? '')
  const kind = input.kind ?? input.type ?? 'base'
  const promptFile = String(input.prompt_file ?? input.promptPath ?? `.threados/prompts/${id || 'step'}.md`)

  return {
    ...input,
    kind,
    type: kind,
    prompt_file: promptFile,
    prompt_ref: derivePromptRef(input, id || 'step', promptFile),
    phase: typeof input.phase === 'string' ? input.phase : 'default',
    agent_ref: typeof input.agent_ref === 'string'
      ? input.agent_ref
      : typeof input.assigned_agent_id === 'string'
        ? input.assigned_agent_id
        : null,
    assigned_agent_id: typeof input.assigned_agent_id === 'string'
      ? input.assigned_agent_id
      : typeof input.agent_ref === 'string'
        ? input.agent_ref
        : undefined,
    surface_ref: typeof input.surface_ref === 'string' ? input.surface_ref : (id ? `thread-${id}` : undefined),
    input_contract_ref: input.input_contract_ref ?? input.input_contract ?? null,
    output_contract_ref: input.output_contract_ref ?? input.output_contract ?? null,
    gate_set_ref: input.gate_set_ref ?? null,
    completion_contract: input.completion_contract ?? null,
    side_effect_class: input.side_effect_class ?? 'none',
    depends_on: Array.isArray(input.depends_on) ? input.depends_on : [],
  }
}

const StepBaseSchema = z.object({
  id: z.string()
    .regex(/^[a-z0-9-]+$/, { message: 'Step ID must contain only lowercase letters, numbers, and hyphens' })
    .min(1, { message: 'Step ID cannot be empty' })
    .max(64, { message: 'Step ID cannot exceed 64 characters' }),
  name: z.string().min(1, { message: 'Step name is required' }),
  kind: StepKindSchema,
  type: StepTypeSchema,
  lane: z.string().optional(),
  role: z.string().optional(),
  cwd: z.string().optional(),
  model: ModelTypeSchema,
  agent_ref: z.string().nullable().default(null),
  prompt_file: z.string().min(1, { message: 'Prompt file path is required' }),
  prompt_ref: PromptRefSchema,
  skill_refs: z.array(SkillRefSchema).optional(),
  llm_settings: LlmSettingsSchema,
  node_description: z.string().optional(),
  expected_outcome: z.string().optional(),
  input_contract: z.string().optional(),
  output_contract: z.string().optional(),
  depends_on: z.array(z.string()).default([]),
  status: StepStatusSchema.default('READY'),
  artifacts: z.array(z.string()).optional(),
  group_id: z.string().optional(),
  fanout: z.number().optional(),
  fusion_candidates: z.boolean().optional(),
  fusion_synth: z.boolean().optional(),
  watchdog_for: z.string().optional(),
  orchestrator: z.string().optional(),
  timeout_ms: z.number().optional(),
  fail_policy: FailPolicySchema.optional(),
  execution: z.enum(['sequential', 'parallel', 'sub_agent']).optional(),
  condition: z.string().optional(),
  actions: z.array(z.unknown()).default([]),
  assigned_agent_id: z.string().optional(),
  phase: z.string(),
  surface_ref: z.string().min(1),
  input_contract_ref: z.string().nullable().default(null),
  output_contract_ref: z.string().nullable().default(null),
  gate_set_ref: z.string().nullable().default(null),
  completion_contract: z.string().nullable().default(null),
  side_effect_class: z.enum(['none', 'read', 'write', 'execute']).default('none'),
})

export const StepSchema = z.preprocess(coerceStep, StepBaseSchema)

export const GateStatusSchema = z.enum(['PENDING', 'APPROVED', 'BLOCKED'])
export type GateStatus = z.infer<typeof GateStatusSchema>

export const GateSchema = z.object({
  id: z.string()
    .regex(/^[a-z0-9-]+$/, { message: 'Gate ID must contain only lowercase letters, numbers, and hyphens' })
    .min(1, { message: 'Gate ID cannot be empty' }),
  name: z.string().min(1, { message: 'Gate name is required' }),
  depends_on: z.array(z.string()),
  status: GateStatusSchema.default('PENDING'),
  cascade: z.boolean().default(false),
  childGateIds: z.array(z.string()).default([]),
  description: z.string().optional(),
  acceptance_conditions: z.array(z.string()).optional(),
  required_review: z.boolean().optional(),
})

export const PolicySchema = z.object({
  safe_mode: z.boolean().optional(),
  max_parallel: z.number().optional(),
  default_timeout_ms: z.number().optional(),
  default_fail_policy: FailPolicySchema.optional(),
  max_spawn_depth: z.number().default(10),
  max_children_per_surface: z.number().default(20),
  max_total_surfaces: z.number().default(200),
}).optional()

export const MetadataSchema = z.object({
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  author: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
}).optional()

function deriveLegacySequenceId(raw: Record<string, unknown>): string {
  const name = typeof raw.name === 'string' ? raw.name : 'sequence'
  const stepIds = Array.isArray(raw.steps)
    ? raw.steps.map((step) => String((step as Record<string, unknown>).id ?? '')).join('|')
    : ''
  const packId = typeof raw.pack_id === 'string' ? raw.pack_id : 'packless'
  const hash = createHash('sha1').update(`${name}:${packId}:${stepIds}`).digest('hex').slice(0, 12)
  return `seq-${hash}`
}

function deriveDeps(steps: CanonicalStep[]): DependencyEdge[] {
  return steps.flatMap(step => step.depends_on.map(dep_id => ({ step_id: step.id, dep_id })))
}

function coerceSequence(raw: unknown): Record<string, unknown> {
  const input = (raw ?? {}) as Record<string, unknown>
  const steps = Array.isArray(input.steps) ? input.steps.map(step => StepBaseSchema.parse(coerceStep(step))) : []
  const createdAt = typeof input.created_at === 'string'
    ? input.created_at
    : typeof (input.metadata as Record<string, unknown> | undefined)?.created_at === 'string'
      ? String((input.metadata as Record<string, unknown>).created_at)
      : new Date().toISOString()
  const updatedAt = typeof input.updated_at === 'string'
    ? input.updated_at
    : typeof (input.metadata as Record<string, unknown> | undefined)?.updated_at === 'string'
      ? String((input.metadata as Record<string, unknown>).updated_at)
      : createdAt

  return {
    ...input,
    id: typeof input.id === 'string' && input.id.length > 0 ? input.id : deriveLegacySequenceId({ ...input, steps }),
    created_at: createdAt,
    updated_at: updatedAt,
    steps,
    deps: Array.isArray(input.deps) ? input.deps : deriveDeps(steps),
    metadata: {
      ...((input.metadata as Record<string, unknown>) ?? {}),
      created_at: createdAt,
      updated_at: updatedAt,
    },
  }
}

const SequenceBaseSchema = z.object({
  id: z.string().min(1),
  version: z.string().default('1.0'),
  name: z.string().min(1, { message: 'Sequence name is required' }),
  thread_type: StepTypeSchema.optional(),
  steps: z.array(StepBaseSchema).default([]),
  deps: z.array(DependencyEdgeSchema).default([]),
  gates: z.array(GateSchema).default([]),
  metadata: MetadataSchema,
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  policy: PolicySchema,
  pack_id: z.string().nullable().default(null),
  pack_version: z.string().nullable().default(null),
  default_policy_ref: z.string().nullable().default(null),
  goal: z.string().min(1).optional(),
  success_criteria: z.array(z.string().min(1)).default([]),
  strategy_options: z.array(StrategyOptionSchema).default([]),
  replan_policy: ReplanPolicySchema,
})

export const SequenceSchema = z.preprocess(coerceSequence, SequenceBaseSchema)

export type SequenceInput = z.input<typeof SequenceBaseSchema>
export type NormalizedSequence = z.output<typeof SequenceBaseSchema>
export type StepInput = z.input<typeof StepBaseSchema>
export type NormalizedStep = z.output<typeof StepBaseSchema>
export type GateInput = z.input<typeof GateSchema>
export type NormalizedGate = z.output<typeof GateSchema>

export type CanonicalStep = NormalizedStep
export type CanonicalSequence = NormalizedSequence

export interface Step {
  id: string
  name: string
  type: StepType
  model: string
  prompt_file: string
  depends_on: string[]
  status: StepStatus
  kind?: StepKind
  lane?: string
  role?: string
  cwd?: string
  agent_ref?: string | null
  prompt_ref?: PromptRef
  skill_refs?: SkillRef[]
  llm_settings?: LlmSettings
  node_description?: string
  expected_outcome?: string
  input_contract?: string
  output_contract?: string
  artifacts?: string[]
  group_id?: string
  fanout?: number
  fusion_candidates?: boolean
  fusion_synth?: boolean
  watchdog_for?: string
  orchestrator?: string
  timeout_ms?: number
  fail_policy?: FailPolicy
  execution?: 'sequential' | 'parallel' | 'sub_agent'
  condition?: string
  actions?: unknown[]
  assigned_agent_id?: string
  phase?: string
  surface_ref?: string
  input_contract_ref?: string | null
  output_contract_ref?: string | null
  gate_set_ref?: string | null
  completion_contract?: string | null
  side_effect_class?: 'none' | 'read' | 'write' | 'execute'
}

export type Gate = z.infer<typeof GateSchema>
export interface Sequence {
  version: string
  name: string
  steps: Step[]
  gates: Gate[]
  id?: string
  thread_type?: StepType
  deps?: DependencyEdge[]
  metadata?: z.infer<typeof MetadataSchema>
  created_at?: string
  updated_at?: string
  policy?: z.infer<typeof PolicySchema>
  pack_id?: string | null
  pack_version?: string | null
  default_policy_ref?: string | null
  goal?: string
  success_criteria?: string[]
  strategy_options?: StrategyOption[]
  replan_policy?: ReplanPolicy
}

export function normalizeStep(step: StepInput): CanonicalStep {
  return StepBaseSchema.parse(coerceStep(step))
}

export function normalizeGate(gate: GateInput): Gate {
  return GateSchema.parse(gate)
}

export function normalizeSequence(sequence: SequenceInput): CanonicalSequence {
  return SequenceBaseSchema.parse(coerceSequence(sequence))
}

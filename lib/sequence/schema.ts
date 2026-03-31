import { z } from 'zod'

// Schema naming convention: use Schema suffix to avoid name collision with types

export const StepStatusSchema = z.enum([
  'READY', 'RUNNING', 'NEEDS_REVIEW', 'DONE', 'FAILED', 'BLOCKED'
])
export type StepStatus = z.infer<typeof StepStatusSchema>

export const StepTypeSchema = z.enum(['base', 'p', 'c', 'f', 'b', 'l'])
export type StepType = z.infer<typeof StepTypeSchema>

/** Known model presets shown in the UI picker — any string is valid for model-agnostic support. */
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

export const StepSchema = z.object({
  id: z.string()
    .regex(/^[a-z0-9-]+$/, { message: 'Step ID must contain only lowercase letters, numbers, and hyphens' })
    .min(1, { message: 'Step ID cannot be empty' })
    .max(64, { message: 'Step ID cannot exceed 64 characters' }),
  name: z.string().min(1, { message: 'Step name is required' }),
  type: StepTypeSchema,
  lane: z.string().optional(),
  role: z.string().optional(),
  cwd: z.string().optional(),
  model: ModelTypeSchema,
  prompt_file: z.string().min(1, { message: 'Prompt file path is required' }),
  prompt_ref: PromptRefSchema.optional(),
  skill_refs: z.array(SkillRefSchema).optional(),
  llm_settings: LlmSettingsSchema,
  node_description: z.string().optional(),
  expected_outcome: z.string().optional(),
  input_contract: z.string().optional(),
  output_contract: z.string().optional(),
  depends_on: z.array(z.string()).default([]),
  status: StepStatusSchema.default('READY'),
  artifacts: z.array(z.string()).optional(),
  // M3 extensions
  group_id: z.string().optional(),
  fanout: z.number().optional(),
  fusion_candidates: z.boolean().optional(),
  fusion_synth: z.boolean().optional(),
  watchdog_for: z.string().optional(),
  orchestrator: z.string().optional(),
  timeout_ms: z.number().optional(),
  fail_policy: FailPolicySchema.optional(),
  assigned_agent_id: z.string().optional(),
  // V.1 extensions
  phase: z.string().optional(),
  surface_ref: z.string().optional(),
  input_contract_ref: z.string().optional(),
  output_contract_ref: z.string().optional(),
  gate_set_ref: z.string().optional(),
  completion_contract: z.string().optional(),
  side_effect_class: z.enum(['none', 'read', 'write', 'execute']).optional(),
})

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

export const SequenceSchema = z.object({
  version: z.string().default('1.0'),
  name: z.string().min(1, { message: 'Sequence name is required' }),
  thread_type: StepTypeSchema.optional(),
  steps: z.array(StepSchema).default([]),
  gates: z.array(GateSchema).default([]),
  metadata: MetadataSchema,
  policy: PolicySchema,
  pack_id: z.string().nullable().default(null),
  pack_version: z.string().nullable().default(null),
  default_policy_ref: z.string().nullable().default(null),
})

export type SequenceInput = z.input<typeof SequenceSchema>
export type NormalizedSequence = z.output<typeof SequenceSchema>
export type StepInput = z.input<typeof StepSchema>
export type NormalizedStep = z.output<typeof StepSchema>
export type GateInput = z.input<typeof GateSchema>
export type NormalizedGate = z.output<typeof GateSchema>

// Clean type exports (no collision with schema names)
export type Step = z.infer<typeof StepSchema>
export type Gate = z.infer<typeof GateSchema>
export type Sequence = Omit<NormalizedSequence, 'pack_id' | 'pack_version' | 'default_policy_ref'> & {
  pack_id?: string | null
  pack_version?: string | null
  default_policy_ref?: string | null
}

export function normalizeStep(step: StepInput): Step {
  return StepSchema.parse(step)
}

export function normalizeGate(gate: GateInput): Gate {
  return GateSchema.parse(gate)
}

export function normalizeSequence(sequence: SequenceInput): Sequence {
  return SequenceSchema.parse(sequence)
}

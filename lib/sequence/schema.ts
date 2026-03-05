import { z } from 'zod'

// Schema naming convention: use Schema suffix to avoid name collision with types

export const StepStatusSchema = z.enum([
  'READY', 'RUNNING', 'NEEDS_REVIEW', 'DONE', 'FAILED', 'BLOCKED'
])
export type StepStatus = z.infer<typeof StepStatusSchema>

export const StepTypeSchema = z.enum(['base', 'p', 'c', 'f', 'b', 'l'])
export type StepType = z.infer<typeof StepTypeSchema>

export const ModelTypeSchema = z.enum(['claude-code', 'codex', 'gemini', 'shell'])
export type ModelType = z.infer<typeof ModelTypeSchema>

export const FailPolicySchema = z.enum(['stop-all', 'continue', 'retry'])
export type FailPolicy = z.infer<typeof FailPolicySchema>

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
})

export const PolicySchema = z.object({
  safe_mode: z.boolean().optional(),
  max_parallel: z.number().optional(),
  default_timeout_ms: z.number().optional(),
  default_fail_policy: FailPolicySchema.optional(),
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
  steps: z.array(StepSchema).default([]),
  gates: z.array(GateSchema).default([]),
  metadata: MetadataSchema,
  policy: PolicySchema,
})

// Clean type exports (no collision with schema names)
export type Step = z.infer<typeof StepSchema>
export type Gate = z.infer<typeof GateSchema>
export type Sequence = z.infer<typeof SequenceSchema>

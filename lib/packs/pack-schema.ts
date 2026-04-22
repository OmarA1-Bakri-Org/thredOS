import { z } from 'zod'

const PACK_ID_PATTERN = /^[a-z0-9-]+$/

function packIdSchema(label: string) {
  return z.string()
    .regex(PACK_ID_PATTERN, { message: `${label} ID must contain only lowercase letters, numbers, and hyphens` })
    .min(1, { message: `${label} ID cannot be empty` })
    .max(64, { message: `${label} ID cannot exceed 64 characters` })
}

export const PackPhaseSchema = z.object({
  id: packIdSchema('Phase'),
  label: z.string().min(1),
  order: z.number().int().nonnegative(),
})

export const PackActionRetrySchema = z.object({
  max_attempts: z.number().int().positive().optional(),
  delay_ms: z.number().int().nonnegative().optional(),
  backoff: z.enum(['none', 'linear', 'exponential']).optional(),
  retry_on: z.array(z.string().min(1)).default([]),
})

export const PackActionConfigSchema = z.object({
  command: z.string().min(1).optional(),
  tool_slug: z.string().min(1).optional(),
  arguments: z.record(z.string(), z.unknown()).optional(),
  skill_name: z.string().min(1).optional(),
  file_path: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  subagent_type: z.string().min(1).optional(),
  approval_prompt: z.string().min(1).optional(),
  condition: z.string().min(1).optional(),
  if_true: z.array(z.unknown()).optional(),
  if_false: z.array(z.unknown()).optional(),
}).catchall(z.unknown())

export const PackActionSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['cli', 'composio_tool', 'skill', 'read_file', 'write_file', 'sub_agent', 'approval', 'conditional']),
  description: z.string().min(1).optional(),
  config: PackActionConfigSchema.default({}),
  retry: PackActionRetrySchema.optional(),
  timeout_ms: z.number().int().nonnegative().optional(),
  output_key: z.string().min(1).optional(),
  on_failure: z.enum(['abort_step', 'abort_workflow', 'skip', 'warn', 'retry']).optional(),
})

export const PackStepSchema = z.object({
  id: packIdSchema('Step'),
  name: z.string().min(1),
  type: z.enum(['base', 'p', 'c', 'f', 'b', 'l']),
  model: z.string().min(1),
  phase: z.string().min(1),
  execution: z.enum(['sequential', 'parallel', 'sub_agent']).optional(),
  timeout_ms: z.number().int().nonnegative().optional(),
  condition: z.string().min(1).optional(),
  surface_class: z.enum(['shared', 'private', 'sealed', 'control']).default('shared'),
  depends_on: z.array(z.string()).default([]),
  actions: z.array(PackActionSchema).default([]),
  prompt_file: z.string().optional(),
  orchestrator: z.string().optional(),
  fusion_candidates: z.boolean().optional(),
  fusion_synth: z.boolean().optional(),
  watchdog_for: z.string().optional(),
})

export const PackStrategyOptionSchema = z.object({
  id: packIdSchema('Strategy option'),
  label: z.string().min(1),
  applies_to: z.array(packIdSchema('Strategy applies_to step')).default([]),
  selects_steps: z.array(packIdSchema('Strategy selects_steps step')).default([]),
  suppresses_steps: z.array(packIdSchema('Strategy suppresses_steps step')).default([]),
  requires_approval: z.boolean().default(false),
}).superRefine((strategy, ctx) => {
  for (const stepId of strategy.selects_steps) {
    if (strategy.suppresses_steps.includes(stepId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['suppresses_steps'],
        message: `Strategy option cannot both select and suppress step \"${stepId}\"`,
      })
    }
  }
})

export const PackReplanPolicySchema = z.object({
  enabled: z.boolean(),
  triggers: z.array(z.enum(['empty_artifact', 'sparse_results'])).default([]),
})

export const PackPrerequisiteConnectionSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['composio', 'direct_api', 'local']),
  required: z.boolean(),
  health_check: z.string().min(1).optional(),
  on_unavailable: z.enum(['abort', 'skip_dependent_steps', 'warn']).optional(),
})

export const PackPrerequisitesSchema = z.object({
  connections: z.array(PackPrerequisiteConnectionSchema).default([]),
  env_vars: z.array(z.string().min(1)).default([]),
  key_ids: z.record(z.string(), z.string()).default({}),
})

export const PackSharedReferenceSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  load_when: z.string().min(1).optional(),
  required: z.boolean().default(false),
})

export const PackRateLimitSchema = z.object({
  max: z.number().int().nonnegative(),
  per: z.enum(['call', 'step', 'session', 'day', 'week']),
  enforce: z.enum(['hard', 'soft']),
  current_check: z.string().min(1).optional(),
  on_breach: z.enum(['abort', 'warn', 'throttle', 'skip_remaining']).optional(),
})

export const PackTimeoutsSchema = z.object({
  workflow_max_ms: z.number().int().nonnegative(),
  step_default_ms: z.number().int().nonnegative(),
  api_call_ms: z.number().int().nonnegative().optional(),
  apollo_poll_ms: z.number().int().nonnegative().optional(),
  approval_wait_ms: z.number().int().nonnegative().optional(),
})

export const PackGateSchema = z.object({
  id: packIdSchema('Gate'),
  step_id: z.string().min(1),
  when: z.enum(['pre', 'post']).default('post'),
  type: z.enum(['hard', 'soft', 'approval']),
  check: z.string().min(1),
  on_fail: z.enum(['abort', 'warn', 'retry', 'skip', 'ask_user', 'flag_for_review']),
  message: z.string().min(1).optional(),
  max_retries: z.number().int().nonnegative().optional(),
  retry_delay_ms: z.number().int().nonnegative().optional(),
  retry_action: z.string().min(1).optional(),
})

const PackManifestBaseSchema = z.object({
  id: packIdSchema('Pack'),
  version: z.string().min(1),
  name: z.string().min(1),
  thread_types: z.array(z.enum(['base', 'p', 'c', 'f', 'b', 'l'])),
  default_policy: z.enum(['SAFE', 'POWER']).default('SAFE'),
  agents: z.array(z.string()).default([]),
  prerequisites: PackPrerequisitesSchema.optional(),
  shared_references: z.array(PackSharedReferenceSchema).default([]),
  rate_limits: z.record(z.string(), PackRateLimitSchema).default({}),
  timeouts: PackTimeoutsSchema.optional(),
  gates: z.array(PackGateSchema).default([]),
  surface_classes: z.array(z.enum(['shared', 'private', 'sealed', 'control'])).default(['shared']),
  phases: z.array(PackPhaseSchema),
  steps: z.array(PackStepSchema),
  gate_sets: z.array(z.string()).default([]),
  goal: z.string().min(1).optional(),
  success_criteria: z.array(z.string().min(1)).default([]),
  strategy_options: z.array(PackStrategyOptionSchema).default([]),
  replan_policy: PackReplanPolicySchema.optional(),
  export_bundle_schema: z.string().optional(),
})

export const PackManifestSchema = PackManifestBaseSchema.superRefine((manifest, ctx) => {
  const phaseIds = new Set(manifest.phases.map(phase => phase.id))
  const stepIds = new Set(manifest.steps.map(step => step.id))

  manifest.steps.forEach((step, stepIndex) => {
    if (!phaseIds.has(step.phase)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['steps', stepIndex, 'phase'],
        message: `Unknown phase "${step.phase}"`,
      })
    }

    step.depends_on.forEach((depId, depIndex) => {
      if (!stepIds.has(depId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['steps', stepIndex, 'depends_on', depIndex],
          message: `Unknown dependency step "${depId}"`,
        })
      }
    })
  })

  manifest.gates.forEach((gate, gateIndex) => {
    if (!stepIds.has(gate.step_id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['gates', gateIndex, 'step_id'],
        message: `Unknown gate target step "${gate.step_id}"`,
      })
    }
  })
})

export type PackManifest = z.infer<typeof PackManifestSchema>
export type PackPhase = z.infer<typeof PackPhaseSchema>
export type PackStep = z.infer<typeof PackStepSchema>

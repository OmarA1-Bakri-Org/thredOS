import { z } from 'zod'
import { WorkflowRunStrategySchema, WorkflowRunTargetSchema } from './schema'

export const RuntimeCommandContextSchema = z.object({
  actor: z.string().min(1),
  interface: z.enum(['api', 'cli', 'chat', 'mcp', 'system']),
  idempotencyKey: z.string().min(1),
  policyConfirmed: z.boolean(),
  requestId: z.string().min(1).optional(),
})
export type RuntimeCommandContext = z.infer<typeof RuntimeCommandContextSchema>

const StartRunCommandSchema = z.object({
  command_type: z.literal('start-run'),
  context: RuntimeCommandContextSchema,
  sequence_id: z.string().min(1),
  target: WorkflowRunTargetSchema,
  strategy: WorkflowRunStrategySchema,
  max_concurrency: z.number().int().positive(),
})

const CancelRunCommandSchema = z.object({
  command_type: z.literal('cancel-run'),
  context: RuntimeCommandContextSchema,
  workflow_run_id: z.string().min(1),
})

const CancelAttemptCommandSchema = z.object({
  command_type: z.literal('cancel-attempt'),
  context: RuntimeCommandContextSchema,
  attempt_id: z.string().min(1),
})

const RetryAttemptCommandSchema = z.object({
  command_type: z.literal('retry-attempt'),
  context: RuntimeCommandContextSchema,
  attempt_id: z.string().min(1),
})

const RetainWorkspaceCommandSchema = z.object({
  command_type: z.literal('retain-workspace'),
  context: RuntimeCommandContextSchema,
  workspace_id: z.string().min(1),
})

const CleanWorkspaceCommandSchema = z.object({
  command_type: z.literal('clean-workspace'),
  context: RuntimeCommandContextSchema,
  workspace_id: z.string().min(1),
})

export {
  CancelAttemptCommandSchema,
  CancelRunCommandSchema,
  CleanWorkspaceCommandSchema,
  RetainWorkspaceCommandSchema,
  RetryAttemptCommandSchema,
  StartRunCommandSchema,
}

export const RuntimeCommandSchema = z.discriminatedUnion('command_type', [
  StartRunCommandSchema,
  CancelRunCommandSchema,
  CancelAttemptCommandSchema,
  RetryAttemptCommandSchema,
  RetainWorkspaceCommandSchema,
  CleanWorkspaceCommandSchema,
])
export type RuntimeCommand = z.infer<typeof RuntimeCommandSchema>

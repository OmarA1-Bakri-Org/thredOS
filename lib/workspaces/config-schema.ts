import { z } from 'zod'

export const DEFAULT_SNAPSHOT_EXCLUSIONS = [
  '.git/',
  '.threados/',
  'node_modules/',
  '.next/',
  'dist/',
  'build/',
  'coverage/',
  '.venv/',
  'venv/',
  'target/',
  '__pycache__/',
] as const

export const DEFAULT_WORKSPACE_LIMITS = {
  max_active: 5,
  max_bytes_each: 5_368_709_120,
  max_total_retained_bytes: 21_474_836_480,
  max_files: 250_000,
} as const

export const WorkspaceLimitsSchema = z.object({
  max_active: z.number().int().positive().default(DEFAULT_WORKSPACE_LIMITS.max_active),
  max_bytes_each: z.number().int().positive().default(DEFAULT_WORKSPACE_LIMITS.max_bytes_each),
  max_total_retained_bytes: z.number().int().positive()
    .default(DEFAULT_WORKSPACE_LIMITS.max_total_retained_bytes),
  max_files: z.number().int().positive().default(DEFAULT_WORKSPACE_LIMITS.max_files),
}).strict().superRefine((limits, context) => {
  if (limits.max_total_retained_bytes < limits.max_bytes_each) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['max_total_retained_bytes'],
      message: 'max_total_retained_bytes must be at least max_bytes_each',
    })
  }
})
export type WorkspaceLimits = z.infer<typeof WorkspaceLimitsSchema>

const SnapshotConfigSchema = z.object({
  exclusions: z.array(z.string().trim().min(1)).default([...DEFAULT_SNAPSHOT_EXCLUSIONS]),
  include_untracked: z.boolean().default(true),
  max_source_retries: z.number().int().nonnegative().default(3),
}).strict()

const SurfaceWorkspaceConfigSchema = WorkspaceLimitsSchema.extend({
  retention: z.enum([
    'cleanup_on_success',
    'retain_until_applied',
    'retain_on_failure',
    'retain_always',
  ]).default('retain_until_applied'),
}).strict()

const CommandListSchema = z.array(z.string().trim().min(1)).default([])

export const WorkspaceConfigSchema = z.object({
  version: z.literal(1).default(1),
  provider: z.enum(['auto', 'copy', 'overlayfs', 'container']).default('auto'),
  runtime_data_root: z.string().trim().min(1).nullable().default(null),
  snapshot: SnapshotConfigSchema.default({
    exclusions: [...DEFAULT_SNAPSHOT_EXCLUSIONS],
    include_untracked: true,
    max_source_retries: 3,
  }),
  workspace: SurfaceWorkspaceConfigSchema.default({
    retention: 'retain_until_applied',
    ...DEFAULT_WORKSPACE_LIMITS,
  }),
  bootstrap: CommandListSchema,
  validate: CommandListSchema,
}).strict()
export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>

export function createDefaultWorkspaceConfig(): WorkspaceConfig {
  return WorkspaceConfigSchema.parse({})
}

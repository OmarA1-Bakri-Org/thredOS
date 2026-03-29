import { z } from 'zod'

export const PolicyModeSchema = z.enum(['SAFE', 'POWER'])
export type PolicyMode = z.infer<typeof PolicyModeSchema>

export const PolicyConfigSchema = z.object({
  mode: PolicyModeSchema.default('SAFE'),
  command_allowlist: z.array(z.string()).default([]),
  cwd_patterns: z.array(z.string()).default(['**']),
  max_fanout: z.number().default(10),
  max_concurrent: z.number().default(5),
  forbidden_patterns: z.array(z.string()).default([]),
  // V.1 extensions
  side_effect_mode: z.enum(['manual_only', 'approved_only', 'free']).default('manual_only'),
  network_mode: z.enum(['off', 'allowlist', 'open']).default('off'),
  allowed_domains: z.array(z.string()).default([]),
  surface_default_visibility: z.enum(['public', 'dependency', 'self_only']).default('dependency'),
  cross_surface_reads: z.enum(['deny', 'dependency_only']).default('dependency_only'),
  sealed_surface_projection: z.enum(['manifest_only', 'full']).default('manifest_only'),
  export_mode: z.enum(['off', 'local_bundle']).default('local_bundle'),
})

export type PolicyConfig = z.infer<typeof PolicyConfigSchema>

export interface PolicyAction {
  type: 'run_command' | 'fanout' | 'concurrent'
  command?: string
  cwd?: string
  fanout_count?: number
  concurrent_count?: number
}

export interface PolicyResult {
  allowed: boolean
  reason?: string
  confirmation_required: boolean
}

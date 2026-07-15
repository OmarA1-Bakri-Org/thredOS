import { z } from 'zod'
import { assertSafePathSegment } from '@/lib/security/safe-path'

const SafePathSegmentSchema = z.string().min(1).refine(value => {
  try {
    assertSafePathSegment(value)
    return true
  } catch {
    return false
  }
}, 'must be a portable file-safe identifier')

export const PackPhaseSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  order: z.number().int().nonnegative(),
})

export const PackStepSchema = z.object({
  id: SafePathSegmentSchema,
  name: z.string().min(1),
  type: z.enum(['base', 'p', 'c', 'f', 'b', 'l']),
  model: z.string().min(1),
  phase: z.string().min(1),
  surface_class: z.enum(['shared', 'private', 'sealed', 'control']).default('shared'),
  depends_on: z.array(z.string()).default([]),
  prompt_file: z.string().optional(),
  orchestrator: z.string().optional(),
  fusion_candidates: z.boolean().optional(),
  fusion_synth: z.boolean().optional(),
  watchdog_for: z.string().optional(),
})

export const PackManifestSchema = z.object({
  id: SafePathSegmentSchema,
  version: SafePathSegmentSchema,
  name: z.string().min(1),
  thread_types: z.array(z.enum(['base', 'p', 'c', 'f', 'b', 'l'])),
  default_policy: z.enum(['SAFE', 'POWER']).default('SAFE'),
  agents: z.array(z.string()).default([]),
  surface_classes: z.array(z.enum(['shared', 'private', 'sealed', 'control'])).default(['shared']),
  phases: z.array(PackPhaseSchema),
  steps: z.array(PackStepSchema),
  gate_sets: z.array(z.string()).default([]),
  export_bundle_schema: z.string().optional(),
})

export type PackManifest = z.infer<typeof PackManifestSchema>
export type PackPhase = z.infer<typeof PackPhaseSchema>
export type PackStep = z.infer<typeof PackStepSchema>

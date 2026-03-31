import type { PackManifest } from './pack-schema'
import type { ThreadSurface } from '@/lib/thread-surfaces/types'

export interface CompileResult {
  sequence: {
    version: string
    name: string
    thread_type: string
    steps: Array<{
      id: string
      name: string
      type: string
      model: string
      prompt_file: string
      depends_on: string[]
      status: string
      phase?: string
      surface_ref?: string
      orchestrator?: string
      fusion_candidates?: boolean
      fusion_synth?: boolean
      watchdog_for?: string
    }>
    gates: unknown[]
    pack_id: string
    pack_version: string
    default_policy_ref: string | null
  }
  surfaces: ThreadSurface[]
}

export function compilePack(manifest: PackManifest): CompileResult {
  const now = new Date().toISOString()

  const steps = manifest.steps.map(ps => ({
    id: ps.id,
    name: ps.name,
    type: ps.type,
    model: ps.model,
    prompt_file: ps.prompt_file ?? `.threados/prompts/${ps.id}.md`,
    depends_on: ps.depends_on,
    status: 'READY' as const,
    phase: ps.phase,
    surface_ref: `thread-${ps.id}`,
    orchestrator: ps.orchestrator,
    fusion_candidates: ps.fusion_candidates,
    fusion_synth: ps.fusion_synth,
    watchdog_for: ps.watchdog_for,
  }))

  const sequence = {
    version: '1.0',
    name: manifest.name,
    thread_type: manifest.thread_types[0],
    steps,
    gates: [] as unknown[],
    pack_id: manifest.id,
    pack_version: manifest.version,
    default_policy_ref: null,
  }

  const rootSurface: ThreadSurface = {
    id: 'thread-root',
    parentSurfaceId: null,
    parentAgentNodeId: null,
    depth: 0,
    surfaceLabel: manifest.name,
    role: 'orchestrator',
    createdAt: now,
    childSurfaceIds: manifest.steps.map(s => `thread-${s.id}`),
    sequenceRef: null,
    spawnedByAgentId: null,
    surfaceClass: 'control',
    visibility: 'dependency',
    isolationLabel: 'NONE',
    revealState: null,
    allowedReadScopes: [],
    allowedWriteScopes: [],
  }

  const stepSurfaces: ThreadSurface[] = manifest.steps.map(ps => ({
    id: `thread-${ps.id}`,
    parentSurfaceId: 'thread-root',
    parentAgentNodeId: ps.id,
    depth: 1,
    surfaceLabel: ps.name,
    role: 'worker' as const,
    createdAt: now,
    childSurfaceIds: [],
    sequenceRef: null,
    spawnedByAgentId: null,
    surfaceClass: ps.surface_class,
    visibility: ps.surface_class === 'sealed' ? 'self_only' as const : 'dependency' as const,
    isolationLabel: ps.surface_class === 'sealed' ? 'THREADOS_SCOPED' as const : 'NONE' as const,
    revealState: ps.surface_class === 'sealed' ? 'sealed' as const : null,
    allowedReadScopes: [],
    allowedWriteScopes: [],
  }))

  return { sequence, surfaces: [rootSurface, ...stepSurfaces] }
}

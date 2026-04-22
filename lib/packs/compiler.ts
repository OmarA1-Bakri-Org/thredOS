import { createHash } from 'crypto'
import type { PackManifest } from './pack-schema'
import type { ThreadSurface } from '@/lib/thread-surfaces/types'

export interface CompilePackOptions {
  installName?: string
  policyMode?: 'SAFE' | 'POWER'
  parallelTracks?: number
  sourceAssetRef?: string
  modelOverrides?: Record<string, string>
}

export interface CompileResult {
  sequence: {
    id: string
    version: string
    name: string
    thread_type: string
    steps: Array<{
      id: string
      name: string
      kind: string
      type: string
      phase: string
      agent_ref: string | null
      model: string
      prompt_file: string
      prompt_ref: { id: string; version: number; path: string }
      surface_ref: string
      depends_on: string[]
      status: string
      input_contract_ref: string | null
      output_contract_ref: string | null
      gate_set_ref: string | null
      completion_contract: string | null
      side_effect_class: 'none' | 'read' | 'write' | 'execute'
      execution?: 'sequential' | 'parallel' | 'sub_agent'
      condition?: string
      actions?: unknown[]
      orchestrator?: string
      fusion_candidates?: boolean
      fusion_synth?: boolean
      watchdog_for?: string
      fanout?: number
      timeout_ms?: number
    }>
    deps: Array<{ step_id: string; dep_id: string }>
    gates: unknown[]
    pack_id: string
    pack_version: string
    default_policy_ref: string | null
    created_at: string
    updated_at: string
    metadata: {
      created_at: string
      updated_at: string
      description?: string
      source_asset_ref?: string
    }
  }
  surfaces: ThreadSurface[]
}

function buildSequenceId(manifest: PackManifest, installName: string): string {
  const digest = createHash('sha1')
    .update(`${manifest.id}:${manifest.version}:${installName}`)
    .digest('hex')
    .slice(0, 12)
  return `seq-${digest}`
}

export function compilePack(manifest: PackManifest, options: CompilePackOptions = {}): CompileResult {
  const now = new Date().toISOString()
  const installName = options.installName ?? manifest.name
  const modelOverrides = options.modelOverrides ?? {}

  const inferSideEffectClass = (actions: unknown[] | undefined): 'none' | 'read' | 'write' | 'execute' => {
    if (!actions || actions.length === 0) return 'none'
    const typed = actions as Array<Record<string, unknown>>
    const actionTypes = typed.map(action => String(action.type ?? ''))
    if (actionTypes.some(type => ['cli', 'composio_tool', 'sub_agent', 'approval', 'conditional'].includes(type))) return 'execute'
    if (actionTypes.some(type => ['write_file'].includes(type))) return 'write'
    if (actionTypes.some(type => ['read_file', 'skill'].includes(type))) return 'read'
    return 'none'
  }

  const steps = manifest.steps.map(ps => {
    const installedPromptFile = `.threados/prompts/${ps.id}.md`
    const authoredPromptPath = ps.prompt_file ?? installedPromptFile
    return {
      id: ps.id,
      name: ps.name,
      kind: ps.type,
      type: ps.type,
      phase: ps.phase,
      agent_ref: null,
      model: modelOverrides[ps.id] ?? ps.model,
      prompt_file: installedPromptFile,
      prompt_ref: {
        id: ps.id,
        version: 1,
        path: authoredPromptPath,
      },
      surface_ref: `thread-${ps.id}`,
      depends_on: ps.depends_on,
      status: 'READY' as const,
      input_contract_ref: null,
      output_contract_ref: null,
      gate_set_ref: manifest.gate_sets[0] ?? null,
      completion_contract: null,
      side_effect_class: inferSideEffectClass(ps.actions),
      execution: ps.execution,
      condition: ps.condition,
      actions: ps.actions,
      orchestrator: ps.orchestrator,
      fusion_candidates: ps.fusion_candidates,
      fusion_synth: ps.fusion_synth,
      watchdog_for: ps.watchdog_for,
      timeout_ms: ps.timeout_ms,
      ...(options.parallelTracks && ps.type === 'p' ? { fanout: options.parallelTracks } : {}),
    }
  })

  const deps = steps.flatMap(step => step.depends_on.map(dep_id => ({ step_id: step.id, dep_id })))
  const gates = (manifest.gates ?? []).map(gate => ({
    id: gate.id,
    name: gate.id,
    depends_on: [gate.step_id],
    status: 'PENDING' as const,
    cascade: false,
    childGateIds: [],
    description: gate.message,
    acceptance_conditions: [gate.check],
    required_review: gate.type === 'approval',
  }))

  const sequence = {
    id: buildSequenceId(manifest, installName),
    version: '1.0',
    name: installName,
    thread_type: manifest.thread_types[0],
    steps,
    deps,
    gates,
    pack_id: manifest.id,
    pack_version: manifest.version,
    default_policy_ref: options.policyMode ? `policy:${options.policyMode}` : manifest.default_policy ? `policy:${manifest.default_policy}` : null,
    created_at: now,
    updated_at: now,
    metadata: {
      created_at: now,
      updated_at: now,
      ...(options.sourceAssetRef ? { source_asset_ref: options.sourceAssetRef } : {}),
    },
  }

  const rootSurface: ThreadSurface = {
    id: 'thread-root',
    parentSurfaceId: null,
    parentAgentNodeId: null,
    depth: 0,
    surfaceLabel: installName,
    role: 'orchestrator',
    createdAt: now,
    childSurfaceIds: manifest.steps.map(s => `thread-${s.id}`),
    sequenceRef: sequence.id,
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
    sequenceRef: sequence.id,
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

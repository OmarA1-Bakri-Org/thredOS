import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getBasePath } from '@/lib/config'
import { handleError, jsonError, requireRequestSession } from '@/lib/api-helpers'
import { readAgentState, updateAgentState } from '@/lib/agents/repository'
import { applyRateLimit } from '@/lib/rate-limit'
import * as cloudRegistry from '@/lib/agents/cloud-registry'
import { buildAgentComposition, buildRegisteredAgentComposition, detectMaterialChange } from '@/lib/agents/composition'
import type { AgentRegistration, AgentSkill } from '@/lib/agents/types'
import { ensureLibraryStructure, readLibraryCatalog, skillRefFromEntry, syncAgentAsset } from '@/lib/library/repository'
import type { SkillRef } from '@/lib/library/types'
import { PromptRefSchema, SkillRefSchema } from '@/lib/sequence/schema'
import { withExclusiveFileLock } from '@/lib/fs/atomic'
import { ensureStateRoot } from '@/lib/runtime/paths'
import { resolvePathWithinRoot } from '@/lib/security/safe-path'

const AgentSkillSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  inherited: z.boolean().optional(),
})

const AgentBodySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  registeredAt: z.string().optional(),
  builderId: z.string().min(1),
  builderName: z.string().min(1),
  threadSurfaceIds: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  model: z.string().min(1).optional(),
  role: z.string().optional(),
  tools: z.array(z.string()).optional(),
  promptRef: PromptRefSchema.nullable().optional(),
  skillRefs: z.array(SkillRefSchema).optional(),
  skills: z.array(AgentSkillSchema).optional(),
  supersedesAgentId: z.string().optional(),
})

const PUBLIC_CLOUD_SYNC_ERROR = 'Cloud registration unavailable'

class MissingAgentPromptError extends Error {}

interface RegistrationResult {
  agent: AgentRegistration
  replacementOf?: string
  materialChange?: true
  reasons?: string[]
}

export async function GET(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const state = await readAgentState(getBasePath())
    return NextResponse.json({ agents: state.agents })
  } catch (err) {
    return handleError(err)
  }
}

interface RequiredStringField {
  value: unknown
  label: string
}

function _validateRequiredStrings(fields: RequiredStringField[]): NextResponse | null {
  for (const { value, label } of fields) {
    if (!value || typeof value !== 'string') {
      return jsonError(`Missing or invalid ${label}`, 'VALIDATION_ERROR', 400)
    }
  }
  return null
}

function buildAgent(
  body: Partial<AgentRegistration> & { supersedesAgentId?: string | null },
  fallback?: AgentRegistration | null,
): AgentRegistration {
  return {
    id: body.id!,
    name: body.name ?? fallback?.name ?? body.id!,
    description: body.description ?? fallback?.description,
    registeredAt: body.registeredAt ?? fallback?.registeredAt ?? new Date().toISOString(),
    builderId: body.builderId ?? fallback?.builderId ?? '',
    builderName: body.builderName ?? fallback?.builderName ?? '',
    threadSurfaceIds: Array.isArray(body.threadSurfaceIds) ? body.threadSurfaceIds : fallback?.threadSurfaceIds ?? [],
    metadata: body.metadata ?? fallback?.metadata,
    model: body.model ?? fallback?.model,
    role: body.role ?? fallback?.role,
    tools: Array.isArray(body.tools) ? body.tools : fallback?.tools ?? [],
    promptRef: body.promptRef ?? fallback?.promptRef ?? null,
    skillRefs: Array.isArray(body.skillRefs) ? body.skillRefs : fallback?.skillRefs ?? [],
    skills: Array.isArray(body.skills) ? body.skills : fallback?.skills,
    composition: body.composition ?? fallback?.composition,
    version: body.version ?? fallback?.version ?? 1,
    supersedesAgentId: body.supersedesAgentId ?? fallback?.supersedesAgentId ?? null,
  }
}

async function resolveSkillRefs(basePath: string, skillRefs?: SkillRef[], skills?: AgentSkill[]): Promise<SkillRef[]> {
  if (Array.isArray(skillRefs) && skillRefs.length > 0) {
    return skillRefs
  }

  if (!Array.isArray(skills) || skills.length === 0) {
    return []
  }

  const catalog = await readLibraryCatalog(basePath)
  return skills.map((skill) => {
    const entry = catalog.skills[skill.id]
    return entry ? skillRefFromEntry(entry) : {
      id: skill.id,
      version: 1,
      path: `.threados/skills/${skill.id}/SKILL.md`,
      capabilities: [],
    }
  })
}

function nextReplacementAgentId(baseId: string, agents: AgentRegistration[]): string {
  let revision = 2
  let candidate = `${baseId}-v${revision}`
  while (agents.some(agent => agent.id === candidate)) {
    revision += 1
    candidate = `${baseId}-v${revision}`
  }
  return candidate
}

async function withAgentAssetLock<T>(basePath: string, operation: () => Promise<T>): Promise<T> {
  const stateRoot = await ensureStateRoot(basePath)
  const assetLockPath = await resolvePathWithinRoot(stateRoot, 'agent-assets.lock')
  return withExclusiveFileLock(assetLockPath, operation, { allowedRoot: basePath })
}

export async function POST(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const rateLimited = applyRateLimit(request, {
      bucket: 'agents-write',
      limit: 30,
      windowMs: 5 * 60 * 1000,
    })
    if (rateLimited) return rateLimited
    const parsed = AgentBodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return jsonError(parsed.error.issues.map(e => e.message).join(', '), 'VALIDATION_ERROR', 400)
    }
    const body = parsed.data

    const bp = getBasePath()
    const skillRefs = await withAgentAssetLock(bp, async () => {
      await ensureLibraryStructure(bp)
      return resolveSkillRefs(bp, body.skillRefs, body.skills)
    })
    const outcome: { registration?: RegistrationResult } = {}

    await updateAgentState(bp, (state) => {
      const currentAgent = state.agents.find(agent => agent.id === body.id) ?? null
      const anchorAgent = body.supersedesAgentId
        ? state.agents.find(agent => agent.id === body.supersedesAgentId) ?? currentAgent
        : currentAgent
      const promptRef = body.promptRef ?? currentAgent?.promptRef ?? anchorAgent?.promptRef ?? null
      if (!promptRef) {
        throw new MissingAgentPromptError('Missing promptRef for canonical agent registration')
      }
      const currentComposition = anchorAgent
        ? buildRegisteredAgentComposition(anchorAgent)
        : null
      const composition = buildAgentComposition({
        model: body.model ?? currentAgent?.model ?? anchorAgent?.model,
        role: body.role ?? currentAgent?.role ?? anchorAgent?.role,
        promptRef,
        skillRefs,
        tools: body.tools ?? currentAgent?.tools ?? anchorAgent?.tools,
      })

      if (anchorAgent && currentComposition) {
        const currentDecision = detectMaterialChange(currentComposition, composition)
        if (currentDecision.material) {
          const anchorId = anchorAgent.id
          const replacementId = body.id !== anchorId && !state.agents.some(agent => agent.id === body.id)
            ? body.id
            : nextReplacementAgentId(anchorId, state.agents)
          const replacement = buildAgent({
            ...body,
            id: replacementId,
            registeredAt: body.registeredAt || new Date().toISOString(),
            model: body.model ?? anchorAgent?.model,
            role: body.role ?? anchorAgent?.role,
            tools: body.tools ?? anchorAgent?.tools,
            promptRef,
            skillRefs,
            skills: body.skills ?? anchorAgent?.skills,
            composition,
            version: (anchorAgent?.version ?? 1) + 1,
            supersedesAgentId: anchorId,
          }, anchorAgent)
          outcome.registration = {
            agent: replacement,
            replacementOf: anchorId,
            materialChange: true,
            reasons: currentDecision.reasons,
          }
          return { ...state, agents: [...state.agents, replacement] }
        }
      }

      const agent = buildAgent({
        ...body,
        model: body.model ?? currentAgent?.model ?? anchorAgent?.model,
        role: body.role ?? currentAgent?.role ?? anchorAgent?.role,
        tools: body.tools ?? currentAgent?.tools ?? anchorAgent?.tools,
        promptRef,
        skillRefs,
        skills: body.skills ?? currentAgent?.skills,
        composition,
        version: currentAgent?.version ?? 1,
        supersedesAgentId: body.supersedesAgentId ?? currentAgent?.supersedesAgentId ?? null,
      }, currentAgent ?? anchorAgent)
      const existingIndex = state.agents.findIndex(a => a.id === agent.id)
      if (existingIndex !== -1) {
        const existing = state.agents[existingIndex]
        const existingComposition = buildRegisteredAgentComposition(existing)
        const nextDecision = detectMaterialChange(existingComposition, composition)
        if (nextDecision.material) {
          throw new Error(`Agent '${agent.id}' already exists with a different composition`)
        }
        const nextAgents = [...state.agents]
        nextAgents[existingIndex] = {
          ...existing,
          ...agent,
          composition,
        }
        outcome.registration = { agent: nextAgents[existingIndex] }
        return {
          ...state,
          agents: nextAgents,
        }
      }
      outcome.registration = { agent }
      return {
        ...state,
        agents: [...state.agents, agent],
      }
    })

    const registration = outcome.registration
    if (!registration) throw new Error('Agent registration did not produce a canonical record')
    const registered = registration.agent
    let cloudRegistration: Awaited<ReturnType<typeof cloudRegistry.registerCloudAgent>> | null = null
    let cloudSyncError: string | null = null
    let persisted = registered

    try {
      const syncedRegistration = await cloudRegistry.registerCloudAgent(bp, registered)
      cloudRegistration = syncedRegistration
      cloudSyncError = null
    } catch (error) {
      console.error('[agents.POST] cloud registration failed', error)
      cloudSyncError = PUBLIC_CLOUD_SYNC_ERROR
    }

    if (cloudRegistration) {
      const synced = await updateAgentState(bp, (current) => ({
        ...current,
        agents: current.agents.map(item => item.id === registered.id
          ? {
              ...item,
              registrationNumber: cloudRegistration!.registrationNumber,
              cloudSyncedAt: new Date().toISOString(),
            }
          : item),
      }))
      persisted = synced.agents.find(a => a.id === registered.id) ?? registered
    }

    await withAgentAssetLock(bp, () => syncAgentAsset(bp, persisted))
    return NextResponse.json({ ...registration, agent: persisted, cloudRegistration, cloudSyncError }, { status: 201 })
  } catch (err) {
    if (err instanceof MissingAgentPromptError) {
      return jsonError(err.message, 'VALIDATION_ERROR', 400)
    }
    if (err instanceof Error && err.message.includes('already exists')) {
      return jsonError(err.message, 'CONFLICT', 409)
    }
    return handleError(err)
  }
}

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
    await ensureLibraryStructure(bp)
    const state = await readAgentState(bp)
    const currentAgent = state.agents.find(agent => agent.id === body.id) ?? null
    const anchorAgent = body.supersedesAgentId
      ? state.agents.find(agent => agent.id === body.supersedesAgentId) ?? currentAgent
      : currentAgent
    const skillRefs = await resolveSkillRefs(bp, body.skillRefs, body.skills)
    const promptRef = body.promptRef ?? currentAgent?.promptRef ?? anchorAgent?.promptRef ?? null
    if (!promptRef) {
      return jsonError('Missing promptRef for canonical agent registration', 'VALIDATION_ERROR', 400)
    }
    const currentComposition = anchorAgent
      ? buildRegisteredAgentComposition({
          model: anchorAgent.model,
          role: anchorAgent.role,
          promptRef: anchorAgent.promptRef,
          skillRefs: anchorAgent.skillRefs,
          tools: anchorAgent.tools,
          composition: anchorAgent.composition,
        })
      : null
    const composition = buildAgentComposition({
      model: body.model ?? currentAgent?.model ?? anchorAgent?.model,
      role: body.role ?? currentAgent?.role ?? anchorAgent?.role,
      promptRef,
      skillRefs,
      tools: body.tools ?? currentAgent?.tools ?? anchorAgent?.tools,
    })

    if (currentComposition) {
      const currentDecision = detectMaterialChange(currentComposition, composition)
      if (currentDecision.material) {
        const anchorId = anchorAgent?.id ?? currentAgent?.id ?? body.id
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

        const updated = await updateAgentState(bp, (current) => {
          const withoutCurrent = current.agents.filter(agent => agent.id !== replacement.id)
          return {
            ...current,
            agents: [...withoutCurrent, replacement],
          }
        })

        const registered = updated.agents.find(agent => agent.id === replacement.id)!
        let cloudRegistration: Awaited<ReturnType<typeof cloudRegistry.registerCloudAgent>> | null = null
        let cloudSyncError: string | null = null
        let persisted = registered

        try {
          const syncedRegistration = await cloudRegistry.registerCloudAgent(bp, registered)
          cloudRegistration = syncedRegistration
          const synced = await updateAgentState(bp, (current) => ({
            ...current,
            agents: current.agents.map(agent => agent.id === registered.id
              ? {
                  ...agent,
                  registrationNumber: syncedRegistration.registrationNumber,
                  cloudSyncedAt: new Date().toISOString(),
                }
              : agent),
          }))
          persisted = synced.agents.find(agent => agent.id === replacement.id) ?? registered
        } catch (error) {
          console.error('[agents.POST] cloud registration failed for replacement agent', error)
          cloudSyncError = PUBLIC_CLOUD_SYNC_ERROR
        }

        await syncAgentAsset(bp, persisted)
        return NextResponse.json({
          agent: persisted,
          cloudRegistration,
          cloudSyncError,
          replacementOf: anchorId,
          materialChange: true,
          reasons: currentDecision.reasons,
        }, { status: 201 })
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

    const updated = await updateAgentState(bp, (state) => {
      const existingIndex = state.agents.findIndex(a => a.id === agent.id)
      if (existingIndex !== -1) {
        const existing = state.agents[existingIndex]
        const existingComposition = buildRegisteredAgentComposition({
          model: existing.model,
          role: existing.role,
          promptRef: existing.promptRef,
          skillRefs: existing.skillRefs,
          tools: existing.tools,
          composition: existing.composition,
        })
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
        return {
          ...state,
          agents: nextAgents,
        }
      }
      return {
        ...state,
        agents: [...state.agents, agent],
      }
    })

    const registered = updated.agents.find(a => a.id === agent.id)!
    let cloudRegistration: Awaited<ReturnType<typeof cloudRegistry.registerCloudAgent>> | null = null
    let cloudSyncError: string | null = null
    let persisted = registered

    try {
      const syncedRegistration = await cloudRegistry.registerCloudAgent(bp, registered)
      cloudRegistration = syncedRegistration
      const synced = await updateAgentState(bp, (current) => ({
        ...current,
        agents: current.agents.map(item => item.id === registered.id
          ? {
              ...item,
              registrationNumber: syncedRegistration.registrationNumber,
              cloudSyncedAt: new Date().toISOString(),
            }
          : item),
      }))
      persisted = synced.agents.find(a => a.id === agent.id) ?? registered
    } catch (error) {
      console.error('[agents.POST] cloud registration failed', error)
      cloudSyncError = PUBLIC_CLOUD_SYNC_ERROR
    }

    await syncAgentAsset(bp, persisted)
    return NextResponse.json({ agent: persisted, cloudRegistration, cloudSyncError }, { status: 201 })
  } catch (err) {
    if (err instanceof Error && err.message.includes('already exists')) {
      return jsonError(err.message, 'CONFLICT', 409)
    }
    return handleError(err)
  }
}

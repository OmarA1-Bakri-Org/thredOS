import { NextResponse } from 'next/server'
import { z } from 'zod'
import { readSequence, writeSequence } from '@/lib/sequence/parser'
import { validateDAG } from '@/lib/sequence/dag'
import { getBasePath } from '@/lib/config'
import { jsonError, auditLog, handleError, requireRequestSession } from '@/lib/api-helpers'
import { applyRateLimit } from '@/lib/rate-limit'
import { StepNotFoundError } from '@/lib/errors'
import { readAgentState, updateAgentState } from '@/lib/agents/repository'
import { writePrompt, deletePrompt, validatePromptExists } from '@/lib/prompts/manager'
import { StepSchema, StepTypeSchema, ModelTypeSchema, StepStatusSchema, type Step } from '@/lib/sequence/schema'
import type { Sequence } from '@/lib/sequence/schema'
import { deriveStepThreadSurfaceId } from '@/lib/thread-surfaces/constants'
import { updateThreadSurfaceState } from '@/lib/thread-surfaces/repository'
import { materializeStepSurface, removeStepSurface } from '@/lib/thread-surfaces/materializer'
import { ensurePromptAssetForStep } from '@/lib/library/repository'

const AddSchema = z.object({
  action: z.literal('add'),
  stepId: z.string(),
  name: z.string().optional(),
  type: z.string().optional(),
  model: z.string().optional(),
  prompt: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
  cwd: z.string().optional(),
})

const EditSchema = z.object({
  action: z.literal('edit'),
  stepId: z.string(),
  name: z.string().optional(),
  type: z.string().optional(),
  model: z.string().optional(),
  prompt: z.string().optional(),
  status: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  assignedAgentId: z.string().trim().min(1).nullable().optional(),
})

const RmSchema = z.object({ action: z.literal('rm'), stepId: z.string() })
const CloneSchema = z.object({ action: z.literal('clone'), sourceId: z.string(), newId: z.string() })

const BodySchema = z.union([AddSchema, EditSchema, RmSchema, CloneSchema])

type AddBody = z.infer<typeof AddSchema>
type EditBody = z.infer<typeof EditSchema>
type RmBody = z.infer<typeof RmSchema>
type CloneBody = z.infer<typeof CloneSchema>

/** Validate a field against a Zod schema, returning a jsonError response on failure. */
function validateField<T>(schema: z.ZodType<T>, value: string, label: string): NextResponse | T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) return jsonError(`Invalid ${label}: ${value}`, 'VALIDATION_ERROR', 400)
  return parsed.data
}

async function handleAdd(body: AddBody, seq: Sequence, bp: string) {
  if (seq.steps.some(s => s.id === body.stepId)) {
    return jsonError(`Step '${body.stepId}' already exists`, 'CONFLICT', 409)
  }

  const newStep = {
    id: body.stepId,
    name: body.name || body.stepId,
    type: body.type || 'base',
    model: body.model || 'claude-code',
    prompt_file: body.prompt || `.threados/prompts/${body.stepId}.md`,
    depends_on: body.dependsOn || [],
    status: 'READY' as const,
    cwd: body.cwd,
  }

  const v = StepSchema.safeParse(newStep)
  if (!v.success) return jsonError(v.error.issues.map(e => e.message).join(', '), 'VALIDATION_ERROR', 400)

  if (!(await validatePromptExists(bp, body.stepId))) {
    await writePrompt(bp, body.stepId, `# ${v.data.name}\n\n<!-- Add your prompt here -->\n`)
  }
  const promptRef = await ensurePromptAssetForStep(bp, body.stepId, v.data.name)

  seq.steps.push({
    ...v.data,
    prompt_ref: promptRef,
  })
  validateDAG(seq)
  await writeSequence(bp, seq)

  try {
    await updateThreadSurfaceState(bp, s =>
      materializeStepSurface(s, body.stepId, v.data.name, seq.name, new Date().toISOString())
    )
  } catch (err) {
    console.error('[step.add] surface sync failed (non-fatal):', err)
  }

  await auditLog('step.add', body.stepId)
  return NextResponse.json({ success: true, action: 'add', stepId: body.stepId })
}

function applyEditFields(step: Step, body: EditBody): NextResponse | null {
  if (body.name) step.name = body.name

  if (body.type) {
    const result = validateField(StepTypeSchema, body.type, 'step type')
    if (result instanceof NextResponse) return result
    step.type = result
  }

  if (body.model) {
    const result = validateField(ModelTypeSchema, body.model, 'model')
    if (result instanceof NextResponse) return result
    step.model = result
  }

  if (body.prompt) {
    step.prompt_file = body.prompt
    step.prompt_ref = {
      id: step.prompt_ref?.id ?? step.id,
      version: step.prompt_ref?.version ?? 1,
      path: body.prompt,
    }
  }

  if (body.status) {
    const result = validateField(StepStatusSchema, body.status, 'status')
    if (result instanceof NextResponse) return result
    step.status = result
  }

  if (body.dependsOn) step.depends_on = body.dependsOn
  if (body.cwd) step.cwd = body.cwd

  if (body.assignedAgentId !== undefined) {
    step.assigned_agent_id = body.assignedAgentId ?? undefined
  }

  return null // no error
}

async function handleEdit(body: EditBody, seq: Sequence, bp: string) {
  const step = seq.steps.find(s => s.id === body.stepId)
  if (!step) throw new StepNotFoundError(body.stepId)
  const previousAssignedAgentId = step.assigned_agent_id

  const fieldError = applyEditFields(step, body)
  if (fieldError) return fieldError

  if (body.assignedAgentId !== undefined && body.assignedAgentId) {
    const agentState = await readAgentState(bp)
    const assignedAgent = agentState.agents.find(agent => agent.id === body.assignedAgentId) ?? null
    if (!assignedAgent) {
      return jsonError(`Unknown agent '${body.assignedAgentId}'`, 'NOT_FOUND', 404)
    }
    if (!assignedAgent.promptRef) {
      return jsonError(`Agent '${body.assignedAgentId}' must be re-registered with a canonical prompt before assignment`, 'VALIDATION_ERROR', 400)
    }
    step.model = assignedAgent.model ?? step.model
    step.role = assignedAgent.role ?? step.role
    step.prompt_ref = assignedAgent.promptRef
    step.prompt_file = assignedAgent.promptRef.path ?? step.prompt_file
    step.skill_refs = (assignedAgent.skillRefs ?? []).map(skill => ({
      ...skill,
      capabilities: skill.capabilities ?? [],
    }))
  }

  validateDAG(seq)
  await writeSequence(bp, seq)

  if (body.assignedAgentId !== undefined) {
    const threadSurfaceId = deriveStepThreadSurfaceId(body.stepId)
    await updateAgentState(bp, (state) => ({
      ...state,
      agents: state.agents.map((agent) => {
        const nextThreadSurfaceIds = agent.threadSurfaceIds.filter(id => id !== threadSurfaceId)
        if (agent.id === body.assignedAgentId) {
          return {
            ...agent,
            threadSurfaceIds: nextThreadSurfaceIds.includes(threadSurfaceId)
              ? nextThreadSurfaceIds
              : [...nextThreadSurfaceIds, threadSurfaceId],
          }
        }
        if (agent.id === previousAssignedAgentId) {
          return {
            ...agent,
            threadSurfaceIds: nextThreadSurfaceIds,
          }
        }
        return agent
      }),
    }))
  }

  await auditLog('step.edit', body.stepId)
  return NextResponse.json({ success: true, action: 'edit', stepId: body.stepId })
}

async function handleRm(body: RmBody, seq: Sequence, bp: string) {
  const idx = seq.steps.findIndex(s => s.id === body.stepId)
  if (idx === -1) throw new StepNotFoundError(body.stepId)

  const deps = seq.steps.filter(s => s.depends_on.includes(body.stepId))
  if (deps.length > 0) {
    return jsonError(`Steps [${deps.map(s => s.id).join(', ')}] depend on '${body.stepId}'`, 'HAS_DEPENDENTS', 409)
  }

  seq.steps.splice(idx, 1)
  await writeSequence(bp, seq)
  try { await deletePrompt(bp, body.stepId) } catch { /* ok */ }

  try {
    await updateThreadSurfaceState(bp, s => removeStepSurface(s, body.stepId))
  } catch (err) {
    console.error('[step.rm] surface sync failed (non-fatal):', err)
  }

  await auditLog('step.rm', body.stepId)
  return NextResponse.json({ success: true, action: 'rm', stepId: body.stepId })
}

async function handleClone(body: CloneBody, seq: Sequence, bp: string) {
  const src = seq.steps.find(s => s.id === body.sourceId)
  if (!src) throw new StepNotFoundError(body.sourceId)
  if (seq.steps.some(s => s.id === body.newId)) {
    return jsonError(`Step '${body.newId}' already exists`, 'CONFLICT', 409)
  }

  const clonedPromptFile = `.threados/prompts/${body.newId}.md`
  const promptRef = await ensurePromptAssetForStep(bp, body.newId, `${src.name} (copy)`)
  const cloned: Step = {
    ...src,
    id: body.newId,
    name: `${src.name} (copy)`,
    prompt_file: clonedPromptFile,
    prompt_ref: promptRef,
    status: 'READY',
  }
  seq.steps.push(cloned)
  validateDAG(seq)
  await writeSequence(bp, seq)
  await writePrompt(bp, body.newId, `# ${cloned.name}\n\n<!-- Add your prompt here -->\n`)

  try {
    await updateThreadSurfaceState(bp, s =>
      materializeStepSurface(s, body.newId, cloned.name, seq.name, new Date().toISOString())
    )
  } catch (err) {
    console.error('[step.clone] surface sync failed (non-fatal):', err)
  }

  await auditLog('step.clone', body.newId, { sourceId: body.sourceId })
  return NextResponse.json({ success: true, action: 'clone', stepId: body.newId })
}

const ACTION_HANDLERS: Record<string, (body: never, seq: Sequence, bp: string) => Promise<NextResponse>> = {
  add: handleAdd as (body: never, seq: Sequence, bp: string) => Promise<NextResponse>,
  edit: handleEdit as (body: never, seq: Sequence, bp: string) => Promise<NextResponse>,
  rm: handleRm as (body: never, seq: Sequence, bp: string) => Promise<NextResponse>,
  clone: handleClone as (body: never, seq: Sequence, bp: string) => Promise<NextResponse>,
}

export async function POST(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const rateLimited = applyRateLimit(request, {
      bucket: 'step-write',
      limit: 30,
      windowMs: 5 * 60 * 1000,
    })
    if (rateLimited) return rateLimited
    const body = BodySchema.parse(await request.json())
    const bp = getBasePath()
    const seq = await readSequence(bp)

    const handler = ACTION_HANDLERS[body.action]
    return await handler(body as never, seq, bp)
  } catch (err) {
    return handleError(err)
  }
}

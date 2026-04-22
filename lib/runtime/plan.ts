import { mkdir, readFile } from 'fs/promises'
import { join } from 'path'
import { writeFileAtomic } from '../fs/atomic'
import { z } from 'zod'

export const StrategyRevisionSchema = z.object({
  revision_id: z.string().min(1),
  ts: z.string().min(1),
  from_strategy: z.string().nullable(),
  to_strategy: z.string().min(1),
  reason: z.string().min(1),
  approval_required: z.boolean(),
  approved: z.boolean(),
})
export type StrategyRevision = z.infer<typeof StrategyRevisionSchema>

export const RuntimePlanSchema = z.object({
  mission_id: z.string().min(1),
  goal: z.string().min(1),
  status: z.enum(['active', 'blocked', 'completed', 'aborted']),
  selected_strategy: z.string().nullable(),
  candidate_strategies: z.array(z.string().min(1)).default([]),
  revisions: z.array(StrategyRevisionSchema).default([]),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
})
export type RuntimePlan = z.infer<typeof RuntimePlanSchema>

export function getRuntimePlanPath(basePath: string): string {
  return join(basePath, '.threados', 'state', 'runtime-plan.json')
}

export async function readRuntimePlan(basePath: string): Promise<RuntimePlan | null> {
  const path = getRuntimePlanPath(basePath)
  try {
    const raw = await readFile(path, 'utf-8')
    return RuntimePlanSchema.parse(JSON.parse(raw))
  } catch (error) {
    const errno = error as NodeJS.ErrnoException
    if (errno?.code === 'ENOENT') return null
    throw error
  }
}

export async function writeRuntimePlan(basePath: string, plan: RuntimePlan): Promise<void> {
  const path = getRuntimePlanPath(basePath)
  await mkdir(join(basePath, '.threados', 'state'), { recursive: true })
  const validated = RuntimePlanSchema.parse(plan)
  await writeFileAtomic(path, JSON.stringify(validated, null, 2) + '\n')
}

export async function initRuntimePlan(basePath: string, input: {
  mission_id: string
  goal: string
  candidate_strategies: string[]
  selected_strategy: string | null
}): Promise<RuntimePlan> {
  const now = new Date().toISOString()
  const plan: RuntimePlan = {
    mission_id: input.mission_id,
    goal: input.goal,
    status: 'active',
    selected_strategy: input.selected_strategy,
    candidate_strategies: input.candidate_strategies,
    revisions: [],
    created_at: now,
    updated_at: now,
  }
  await writeRuntimePlan(basePath, plan)
  return plan
}

export async function appendPlanRevision(basePath: string, revision: StrategyRevision): Promise<RuntimePlan> {
  const existing = await readRuntimePlan(basePath)
  if (!existing) {
    throw new Error('Cannot append plan revision before runtime plan initialization')
  }
  const updated: RuntimePlan = {
    ...existing,
    revisions: [...existing.revisions, StrategyRevisionSchema.parse(revision)],
    updated_at: new Date().toISOString(),
  }
  await writeRuntimePlan(basePath, updated)
  return updated
}

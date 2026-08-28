import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRequestSession } from '@/lib/api-helpers'
import { getBasePath } from '@/lib/config'
import {
  ensureLocalWorkspace,
  projectLocalWorkspace,
  readLocalWorkspace,
  readLocalWorkspaceIdentity,
  writeLocalWorkspace,
} from '@/lib/local-first/workspace'
import { applyRateLimit } from '@/lib/rate-limit'
import { loadWorkspaceConfig, writeWorkspaceConfig } from '@/lib/workspaces/config'
import { WorkspaceConfigSchema } from '@/lib/workspaces/config-schema'

const BodySchema = z.object({
  label: z.string().min(1).optional(),
  runtimeTarget: z.enum(['desktop', 'node']).optional(),
  runtimeDataRoot: z.string().trim().min(1).nullable().optional(),
}).superRefine((body, context) => {
  if (body.runtimeDataRoot !== undefined && (body.label !== undefined || body.runtimeTarget !== undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['runtimeDataRoot'],
      message: 'runtimeDataRoot must be updated independently from label or runtimeTarget',
    })
  }
})

export async function GET(request: Request) {
  const session = requireRequestSession(request)
  if (session instanceof NextResponse) return session

  const workspace = await ensureLocalWorkspace(getBasePath())
  return NextResponse.json({ workspace })
}

export async function POST(request: Request) {
  const session = requireRequestSession(request)
  if (session instanceof NextResponse) return session
  const rateLimited = applyRateLimit(request, {
    bucket: 'desktop-workspace-write',
    limit: 30,
    windowMs: 5 * 60 * 1000,
  })
  if (rateLimited) return rateLimited

  const parsed = BodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map(issue => issue.message).join(', ') }, { status: 400 })
  }

  const basePath = getBasePath()
  if (parsed.data.runtimeDataRoot !== undefined) {
    const current = await readLocalWorkspaceIdentity(basePath)
    const currentConfig = await loadWorkspaceConfig(basePath)
    const nextConfig = WorkspaceConfigSchema.parse({
      ...currentConfig,
      runtime_data_root: parsed.data.runtimeDataRoot,
    })
    let projectedWorkspace
    try {
      projectedWorkspace = await projectLocalWorkspace(basePath, current, nextConfig)
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : String(error),
        code: 'INVALID_RUNTIME_DATA_ROOT',
      }, { status: 400 })
    }
    await writeWorkspaceConfig(basePath, nextConfig)
    return NextResponse.json({ workspace: projectedWorkspace })
  }
  const current = await readLocalWorkspace(basePath)
  const nextWorkspace = {
    ...current,
    ...(parsed.data.label ? { label: parsed.data.label } : {}),
    ...(parsed.data.runtimeTarget ? { runtimeTarget: parsed.data.runtimeTarget } : {}),
    lastOpenedAt: new Date().toISOString(),
  }
  await writeLocalWorkspace(basePath, nextWorkspace)
  return NextResponse.json({ workspace: nextWorkspace })
}

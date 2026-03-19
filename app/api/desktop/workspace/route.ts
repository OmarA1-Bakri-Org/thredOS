import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getBasePath } from '@/lib/config'
import { ensureLocalWorkspace, readLocalWorkspace, writeLocalWorkspace } from '@/lib/local-first/workspace'

const BodySchema = z.object({
  label: z.string().min(1).optional(),
  runtimeTarget: z.enum(['desktop', 'node']).optional(),
})

export async function GET() {
  const workspace = await ensureLocalWorkspace(getBasePath())
  return NextResponse.json({ workspace })
}

export async function POST(request: Request) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map(issue => issue.message).join(', ') }, { status: 400 })
  }

  const basePath = getBasePath()
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

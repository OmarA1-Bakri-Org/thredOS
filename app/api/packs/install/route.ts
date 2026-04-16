import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getBasePath } from '@/lib/config'
import { handleError, requireRequestSession } from '@/lib/api-helpers'
import { applyRateLimit } from '@/lib/rate-limit'
import { installPack, type PackInstallInput } from '@/lib/packs/install'

const BodySchema = z.object({
  packId: z.string().min(1),
  version: z.string().min(1),
  installName: z.string().min(1).optional(),
  compileOverrides: z.object({
    sourceAssetRef: z.string().optional(),
    parallelTracks: z.number().int().positive().optional(),
    policyMode: z.enum(['SAFE', 'POWER']).optional(),
    modelOverrides: z.record(z.string(), z.string()).optional(),
  }).optional(),
})

export async function POST(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const rateLimited = applyRateLimit(request, {
      bucket: 'packs-install',
      limit: 20,
      windowMs: 5 * 60 * 1000,
    })
    if (rateLimited) return rateLimited

    const body = BodySchema.parse(await request.json()) as PackInstallInput
    const result = await installPack(getBasePath(), body)
    return NextResponse.json({ success: true, ...result }, { status: 201 })
  } catch (error) {
    return handleError(error)
  }
}

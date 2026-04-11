import { NextResponse } from 'next/server'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod'
import { generateExportBundle } from '@/lib/exports/bundler'
import { ExportBundleSchema } from '@/lib/exports/schema'
import { PolicyEngine } from '@/lib/policy/engine'
import { getBasePath } from '@/lib/config'
import { handleError, requireRequestSession } from '@/lib/api-helpers'
import { applyRateLimit } from '@/lib/rate-limit'

const BodySchema = z.object({
  runId: z.string().regex(/^[A-Za-z0-9._-]+$/, 'runId must be a file-safe identifier'),
})

export async function POST(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const rateLimited = applyRateLimit(request, {
      bucket: 'exports-run-bundle',
      limit: 30,
      windowMs: 5 * 60 * 1000,
    })
    if (rateLimited) return rateLimited

    const parsed = BodySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({
        error: parsed.error.issues.map(issue => issue.message).join(', '),
        code: 'VALIDATION_ERROR',
      }, { status: 400 })
    }
    const { runId } = parsed.data

    const bp = getBasePath()
    const policy = await PolicyEngine.load(bp)
    if (policy.getConfig().export_mode === 'off') {
      return NextResponse.json(
        { error: 'Exports are disabled by policy', code: 'POLICY_DENIED' },
        { status: 403 },
      )
    }

    const bundle = await generateExportBundle(bp, runId)
    const validatedBundle = ExportBundleSchema.parse(bundle)
    const exportDir = join(bp, '.threados/exports', runId)
    await mkdir(exportDir, { recursive: true })
    await writeFile(join(exportDir, 'bundle.json'), JSON.stringify(validatedBundle, null, 2), 'utf-8')

    return NextResponse.json({ bundle: validatedBundle, exportPath: `.threados/exports/${runId}/bundle.json` })
  } catch (err) {
    return handleError(err)
  }
}

import { NextResponse } from 'next/server'
import { mkdir } from 'fs/promises'
import { z } from 'zod'
import { generateExportBundle } from '@/lib/exports/bundler'
import { ExportBundleSchema, type ExportBundle } from '@/lib/exports/schema'
import { PolicyEngine } from '@/lib/policy/engine'
import { getBasePath } from '@/lib/config'
import { handleError, requireRequestSession } from '@/lib/api-helpers'
import { applyRateLimit } from '@/lib/rate-limit'
import {
  assertSafePathSegment,
  resolveExistingPathWithinRoot,
  resolvePathWithinRoot,
} from '@/lib/security/safe-path'
import { writeFileNoFollow } from '@/lib/security/safe-io'

function isSafeRunId(value: string): boolean {
  try {
    assertSafePathSegment(value, 'runId')
    return true
  } catch {
    return false
  }
}

const BodySchema = z.object({
  runId: z.string().refine(isSafeRunId, 'runId must be a file-safe identifier'),
})

async function writeRedactedExportRecords(exportDir: string, bundle: ExportBundle): Promise<void> {
  const verifiedExportDir = await resolveExistingPathWithinRoot(exportDir)
  for (const [fileName, records] of [
    ['trace.ndjson', bundle.trace_events],
    ['approvals.ndjson', bundle.approvals],
    ['gate-decisions.ndjson', bundle.gate_decisions],
  ] as const) {
    const destinationPath = await resolvePathWithinRoot(verifiedExportDir, fileName)
    await writeFileNoFollow(
      destinationPath,
      records.length > 0 ? `${records.map(record => JSON.stringify(record)).join('\n')}\n` : '',
    )
  }
}

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
    const threadosRoot = await resolveExistingPathWithinRoot(bp, '.threados')
    const exportsRoot = await resolvePathWithinRoot(threadosRoot, 'exports')
    await mkdir(exportsRoot, { recursive: true })
    const verifiedExportsRoot = await resolveExistingPathWithinRoot(threadosRoot, 'exports')
    const exportDir = await resolvePathWithinRoot(verifiedExportsRoot, runId)
    await mkdir(exportDir, { recursive: true })
    const verifiedExportDir = await resolveExistingPathWithinRoot(verifiedExportsRoot, runId)
    const bundlePath = await resolvePathWithinRoot(verifiedExportDir, 'bundle.json')
    await writeFileNoFollow(bundlePath, JSON.stringify(validatedBundle, null, 2))
    await writeRedactedExportRecords(verifiedExportDir, validatedBundle)

    return NextResponse.json({ bundle: validatedBundle, exportPath: `.threados/exports/${runId}/bundle.json` })
  } catch (err) {
    return handleError(err)
  }
}

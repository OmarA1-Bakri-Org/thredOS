import { NextResponse } from 'next/server'
import { mkdir } from 'fs/promises'
import { z } from 'zod'
import { generateExportBundle } from '@/lib/exports/bundler'
import { ExportBundleSchema } from '@/lib/exports/schema'
import { PolicyEngine } from '@/lib/policy/engine'
import { getBasePath } from '@/lib/config'
import { handleError, requireRequestSession } from '@/lib/api-helpers'
import { applyRateLimit } from '@/lib/rate-limit'
import {
  assertSafePathSegment,
  resolveExistingPathWithinRoot,
  resolvePathWithinRoot,
} from '@/lib/security/safe-path'
import { copyFileNoFollow, writeFileNoFollow } from '@/lib/security/safe-io'

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

async function copyIfPresent(sourceRoot: string, destinationRoot: string, fileName: string): Promise<void> {
  try {
    const sourcePath = await resolveExistingPathWithinRoot(sourceRoot, fileName)
    const destinationPath = await resolvePathWithinRoot(destinationRoot, fileName)
    await copyFileNoFollow(sourcePath, destinationPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    throw error
  }
}

async function copyRuntimeExportRecords(basePath: string, runId: string, exportDir: string): Promise<void> {
  let runDir: string
  try {
    const threadosRoot = await resolveExistingPathWithinRoot(basePath, '.threados')
    const runsRoot = await resolveExistingPathWithinRoot(threadosRoot, 'runs')
    runDir = await resolveExistingPathWithinRoot(runsRoot, runId)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  const verifiedExportDir = await resolveExistingPathWithinRoot(exportDir)
  await Promise.all([
    copyIfPresent(runDir, verifiedExportDir, 'trace.ndjson'),
    copyIfPresent(runDir, verifiedExportDir, 'approvals.ndjson'),
    copyIfPresent(runDir, verifiedExportDir, 'gate-decisions.ndjson'),
  ])
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
    await copyRuntimeExportRecords(bp, runId, verifiedExportDir)

    return NextResponse.json({ bundle: validatedBundle, exportPath: `.threados/exports/${runId}/bundle.json` })
  } catch (err) {
    return handleError(err)
  }
}

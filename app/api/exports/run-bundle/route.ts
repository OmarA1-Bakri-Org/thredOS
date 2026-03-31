import { NextResponse } from 'next/server'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { generateExportBundle } from '@/lib/exports/bundler'
import { getBasePath } from '@/lib/config'
import { handleError, requireRequestSession } from '@/lib/api-helpers'

export async function POST(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session

    const body = await request.json()
    const { runId } = body
    if (!runId) {
      return NextResponse.json({ error: 'runId required', code: 'MISSING_PARAM' }, { status: 400 })
    }

    const bp = getBasePath()
    const bundle = await generateExportBundle(bp, runId)
    const exportDir = join(bp, '.threados/exports', runId)
    await mkdir(exportDir, { recursive: true })
    await writeFile(join(exportDir, 'bundle.json'), JSON.stringify(bundle, null, 2), 'utf-8')

    return NextResponse.json({ bundle, exportPath: `.threados/exports/${runId}/bundle.json` })
  } catch (err) {
    return handleError(err)
  }
}

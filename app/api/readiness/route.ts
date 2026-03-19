import { NextResponse } from 'next/server'
import { getBasePath } from '@/lib/config'
import { ensureLibraryStructure } from '@/lib/library/repository'
import { readSequence } from '@/lib/sequence/parser'

export async function GET() {
  try {
    const basePath = getBasePath()
    await ensureLibraryStructure(basePath)
    await readSequence(basePath)
    return NextResponse.json({
      ready: true,
      basePath,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Readiness check failed'
    return NextResponse.json({
      ready: false,
      error: message,
      timestamp: new Date().toISOString(),
    }, { status: 503 })
  }
}

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getBasePath } from '@/lib/config'
import { auditLog, handleError, jsonError, requireRequestSession } from '@/lib/api-helpers'
import { applyRateLimit } from '@/lib/rate-limit'
import {
  deleteLibraryAsset,
  ensureLibraryStructure,
  listLibraryAssets,
  readLibraryAsset,
  readLibraryCatalog,
  upsertLibraryAsset,
} from '@/lib/library/repository'

const KindSchema = z.enum(['prompt', 'skill', 'agent'])

const QuerySchema = z.object({
  kind: KindSchema.optional(),
  id: z.string().optional(),
})

const WriteSchema = z.object({
  action: z.enum(['upsert', 'delete']),
  kind: KindSchema,
  id: z.string().min(1),
  title: z.string().min(1).optional(),
  content: z.string().optional(),
  description: z.string().optional(),
  lastEditor: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
})

function defaultAssetContent(kind: 'prompt' | 'skill' | 'agent', id: string, title: string): string {
  const heading = title || id
  if (kind === 'prompt') {
    return `---\nid: ${id}\ntitle: ${heading}\n---\n\n# ${heading}\n\nDescribe the task for this node.\n`
  }
  if (kind === 'skill') {
    return `---\nid: ${id}\ntitle: ${heading}\n---\n\n# ${heading}\n\nDescribe the canonical behavior for this skill.\n`
  }
  return `---\nid: ${id}\nname: ${heading}\n---\n\n# ${heading}\n\nDescribe the registered agent.\n`
}

export async function GET(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const url = new URL(request.url)
    const query = QuerySchema.parse({
      kind: url.searchParams.get('kind') ?? undefined,
      id: url.searchParams.get('id') ?? undefined,
    })

    const basePath = getBasePath()
    await ensureLibraryStructure(basePath)

    if (query.kind && query.id) {
      const asset = await readLibraryAsset(basePath, query.kind, query.id)
      if (!asset.entry) {
        return jsonError('Library asset not found', 'NOT_FOUND', 404)
      }
      return NextResponse.json(asset)
    }

    if (query.kind) {
      const assets = await listLibraryAssets(basePath, query.kind)
      return NextResponse.json({ kind: query.kind, assets })
    }

    const catalog = await readLibraryCatalog(basePath)
    return NextResponse.json(catalog)
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const rateLimited = applyRateLimit(request, {
      bucket: 'library-write',
      limit: 30,
      windowMs: 5 * 60 * 1000,
    })
    if (rateLimited) return rateLimited
    const body = WriteSchema.parse(await request.json())
    const basePath = getBasePath()
    await ensureLibraryStructure(basePath)

    if (body.action === 'delete') {
      const deleted = await deleteLibraryAsset(basePath, body.kind, body.id)
      if (!deleted) {
        return jsonError('Library asset not found', 'NOT_FOUND', 404)
      }
      await auditLog('library.delete', `${body.kind}:${body.id}`)
      return NextResponse.json({ ok: true, deleted: true })
    }

    const asset = await upsertLibraryAsset(basePath, {
      kind: body.kind,
      id: body.id,
      title: body.title ?? body.id,
      content: body.content?.trim() ? body.content : defaultAssetContent(body.kind, body.id, body.title ?? body.id),
      description: body.description,
      lastEditor: body.lastEditor,
      capabilities: body.capabilities,
    })
    await auditLog('library.upsert', `${body.kind}:${body.id}`)
    return NextResponse.json({ ok: true, asset }, { status: 201 })
  } catch (err) {
    return handleError(err)
  }
}

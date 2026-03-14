import { PackRepository } from '@/lib/packs/repository'
import type { Pack, PackStatus, PackType } from '@/lib/packs/types'

const repo = new PackRepository()

export async function GET() {
  const packs = repo.listPacks()
  return Response.json({ packs })
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { id, builderId, builderName, division, classification, type } = body as {
      id?: string
      builderId: string
      builderName: string
      division: string
      classification: string
      type: PackType
    }

    if (!builderId || !builderName || !division || !classification || !type) {
      return Response.json({ error: 'Missing required fields: builderId, builderName, division, classification, type' }, { status: 400 })
    }

    const pack: Pack = {
      id: id ?? crypto.randomUUID(),
      type,
      builderId,
      builderName,
      division,
      classification,
      acquiredAt: new Date().toISOString(),
      highestStatus: type,
      statusHistory: [],
    }

    repo.addPack(pack)

    return Response.json({ success: true, pack })
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const { packId, newStatus, context } = body as {
      packId: string
      newStatus: PackStatus
      context: string
    }

    if (!packId || !newStatus || !context) {
      return Response.json({ error: 'Missing required fields: packId, newStatus, context' }, { status: 400 })
    }

    const promoted = repo.promoteStatus(packId, newStatus, context)

    if (!promoted) {
      return Response.json({ error: 'Pack not found or status cannot be promoted (must be unidirectional)' }, { status: 400 })
    }

    const pack = repo.listPacks().find(p => p.id === packId)
    return Response.json({ success: true, pack })
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

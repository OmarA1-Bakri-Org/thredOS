import { NextResponse } from 'next/server'
import { getBasePath } from '@/lib/config'
import { readPackState, updatePackState } from '@/lib/packs/repository'
import type { Pack, PackStatus } from '@/lib/packs/types'
import { requireRequestSession } from '@/lib/api-helpers'

export async function GET(request?: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const state = await readPackState(getBasePath())
    return NextResponse.json({ packs: state.packs })
  } catch {
    return NextResponse.json({ error: 'Failed to read packs' }, { status: 500 })
  }
}

const NEXT_STATUS: Record<PackStatus, PackStatus | null> = {
  challenger: 'champion',
  champion: 'hero',
  hero: null,
}

export async function POST(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const body = await request.json()
    const { action } = body as { action: string }
    const bp = getBasePath()

    if (action === 'create') {
      const { id, type, division, classification, builderId, builderName } = body as {
        id: string; type: string; division: string; classification: string
        builderId: string; builderName: string
      }
      if (!id || !type || !builderId || !builderName) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
      }

      const updated = await updatePackState(bp, (state) => {
        if (state.packs.some(p => p.id === id)) {
          throw new Error(`Pack '${id}' already exists`)
        }
        const pack: Pack = {
          id,
          type: type as Pack['type'],
          division: division || 'Unclassified',
          classification: classification || 'Alpha',
          highestStatus: 'challenger',
          statusHistory: [{ status: 'challenger', achievedAt: new Date().toISOString(), context: 'Pack created' }],
          builderId,
          builderName,
          acquiredAt: new Date().toISOString(),
        }
        return { ...state, packs: [...state.packs, pack] }
      })

      const created = updated.packs.find(p => p.id === id)!
      return NextResponse.json({ pack: created }, { status: 201 })
    }

    if (action === 'promote') {
      const { packId } = body as { packId: string }
      if (!packId) {
        return NextResponse.json({ error: 'Missing packId' }, { status: 400 })
      }

      const updated = await updatePackState(bp, (state) => {
        const pack = state.packs.find(p => p.id === packId)
        if (!pack) throw new Error(`Pack '${packId}' not found`)

        const next = NEXT_STATUS[pack.highestStatus]
        if (!next) throw new Error(`Pack '${packId}' is already at maximum status (hero)`)

        return {
          ...state,
          packs: state.packs.map(p =>
            p.id === packId
              ? {
                  ...p,
                  highestStatus: next,
                  statusHistory: [...p.statusHistory, { status: next, achievedAt: new Date().toISOString(), context: `Promoted to ${next}` }],
                }
              : p
          ),
        }
      })

      const promoted = updated.packs.find(p => p.id === packId)!
      return NextResponse.json({ pack: promoted })
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    if (message.includes('already exists')) {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    if (message.includes('not found') || message.includes('maximum status')) {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

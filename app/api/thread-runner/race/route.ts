import { getBasePath } from '@/lib/config'
import { enrollRace, recordRun, listRaces, getRaceResults } from '@/lib/thread-runner/race-executor'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const raceId = url.searchParams.get('raceId')
    const bp = getBasePath()

    if (raceId) {
      const results = await getRaceResults(bp, raceId)
      return Response.json({ results })
    }

    const races = await listRaces(bp)
    return Response.json({ races })
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { action } = body as { action: string }
    const bp = getBasePath()

    if (action === 'enroll') {
      const { name, division, classification, maxCombatants } = body as {
        name: string; division: string; classification: string; maxCombatants?: number
      }
      if (!name || !division || !classification) {
        return Response.json({ error: 'Missing required fields: name, division, classification' }, { status: 400 })
      }
      const race = await enrollRace(bp, { name, division, classification, maxCombatants: maxCombatants ?? 4 })
      return Response.json({ success: true, race }, { status: 201 })
    }

    if (action === 'record-run') {
      const { raceId, combatantId, threadSurfaceId } = body as {
        raceId: string; combatantId: string; threadSurfaceId: string
      }
      if (!raceId || !combatantId || !threadSurfaceId) {
        return Response.json({ error: 'Missing required fields: raceId, combatantId, threadSurfaceId' }, { status: 400 })
      }
      const run = await recordRun(bp, { raceId, combatantId, threadSurfaceId })
      return Response.json({ success: true, run }, { status: 201 })
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    const status = message.includes('not found') || message.includes('full') ? 400 : 500
    return Response.json({ error: message }, { status })
  }
}

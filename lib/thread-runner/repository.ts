import { existsSync } from 'fs'
import { mkdir, readFile } from 'fs/promises'
import { join } from 'path'
import { writeFileAtomic } from '@/lib/fs/atomic'
import type { EligibilityStatus, CombatantRun, Race, RaceResult } from './types'

// ---------------------------------------------------------------------------
// Persistent file-based state
// ---------------------------------------------------------------------------

const THREAD_RUNNER_STATE_PATH = '.threados/state/thread-runner.json'

export interface ThreadRunnerState {
  version: 1
  races: Race[]
  combatantRuns: CombatantRun[]
}

const DEFAULT_THREAD_RUNNER_STATE: ThreadRunnerState = {
  version: 1,
  races: [],
  combatantRuns: [],
}

export function getThreadRunnerStatePath(basePath: string): string {
  return join(basePath, THREAD_RUNNER_STATE_PATH)
}

export async function readThreadRunnerState(basePath: string): Promise<ThreadRunnerState> {
  const fullPath = getThreadRunnerStatePath(basePath)
  if (!existsSync(fullPath)) {
    return structuredClone(DEFAULT_THREAD_RUNNER_STATE)
  }

  const raw = JSON.parse(await readFile(fullPath, 'utf-8')) as Partial<ThreadRunnerState>

  return {
    version: 1,
    races: Array.isArray(raw.races) ? raw.races : [],
    combatantRuns: Array.isArray(raw.combatantRuns) ? raw.combatantRuns : [],
  }
}

export async function writeThreadRunnerState(basePath: string, state: ThreadRunnerState): Promise<void> {
  const fullPath = getThreadRunnerStatePath(basePath)
  await mkdir(join(basePath, '.threados/state'), { recursive: true })
  await writeFileAtomic(fullPath, `${JSON.stringify({ ...state, version: 1 }, null, 2)}\n`)
}

export async function updateThreadRunnerState(
  basePath: string,
  updater: (currentState: ThreadRunnerState) => ThreadRunnerState | Promise<ThreadRunnerState>,
): Promise<ThreadRunnerState> {
  const currentState = await readThreadRunnerState(basePath)
  const nextState = await updater(currentState)
  await writeThreadRunnerState(basePath, nextState)
  return nextState
}

// ---------------------------------------------------------------------------
// Eligibility check
// ---------------------------------------------------------------------------

/**
 * Check eligibility for Thread Runner access.
 * Currently all requirements are locked (no registration/subscription system yet).
 */
export function checkEligibility(): EligibilityStatus {
  return {
    eligible: false,
    requirements: [
      {
        key: 'verified-identity',
        label: 'Verified Identity',
        description: 'A verified thredOS identity linked to your account.',
        met: false,
      },
      {
        key: 'vm-access',
        label: 'VM Access',
        description: 'Managed VM runtime for sandboxed execution environments.',
        met: false,
      },
      {
        key: 'active-subscription',
        label: 'Active Subscription',
        description: 'An active paid subscription to the Thread Runner tier.',
        met: false,
      },
    ],
  }
}

/**
 * In-memory race store for the local-first runtime.
 * Will be replaced with persistent storage when the Thread Runner domain matures.
 */
export class ThreadRunnerRepository {
  private races: Map<string, Race> = new Map()
  private combatantRuns: Map<string, CombatantRun> = new Map()

  enrollRace(race: Race): void {
    this.races.set(race.id, race)
  }

  getRace(raceId: string): Race | null {
    return this.races.get(raceId) ?? null
  }

  listRaces(): Race[] {
    return Array.from(this.races.values())
  }

  recordCombatantRun(run: CombatantRun): void {
    this.combatantRuns.set(run.id, run)
    const race = this.races.get(run.raceId)
    if (race && !race.combatantRunIds.includes(run.id)) {
      race.combatantRunIds.push(run.id)
    }
  }

  getCombatantRun(runId: string): CombatantRun | null {
    return this.combatantRuns.get(runId) ?? null
  }

  getResultsForRace(raceId: string): RaceResult {
    const race = this.races.get(raceId)
    if (!race) {
      return { raceId, placements: [] }
    }

    const completedRuns = race.combatantRunIds
      .map(id => this.combatantRuns.get(id))
      .filter((run): run is CombatantRun => run != null && run.status === 'completed' && run.placement != null)
      .sort((a, b) => (a.placement ?? 0) - (b.placement ?? 0))

    return {
      raceId,
      placements: completedRuns.map(run => ({
        combatantRunId: run.id,
        combatantId: run.combatantId,
        placement: run.placement!,
        time: run.endedAt && run.startedAt
          ? new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime()
          : 0,
        verifiedAt: run.verifiedAt ?? new Date().toISOString(),
      })),
    }
  }
}

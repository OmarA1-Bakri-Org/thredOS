import type { AgentRegistration } from './types'
import type { AgentStats } from './stats'
import type { Pack, PackStatus } from '../packs/types'
import type { ThreadCardProfile, ThreadRubricMetric, ThreadSkillBadge } from '@/components/hierarchy/FocusedThreadCard'

/**
 * Context passed into the profile builder from the UI layer —
 * the minimal set of hierarchy-view data needed alongside
 * agent/pack/race data.
 */
export interface ProfileNodeContext {
  surfaceLabel: string
  depth: number
  childCount: number
  role: string | null
  runStatus: string | null
  runSummary: string | null
  linkedSurfaceCount: number
}

/**
 * All the data sources that feed the trading card profile.
 * Any of these can be null — the builder degrades gracefully.
 */
export interface ProfileDataSources {
  agent: AgentRegistration | null
  stats: AgentStats | null
  pack: Pack | null
  node: ProfileNodeContext
}

// ── Pack → display name mapping ──────────────────────────────────────

const PACK_DISPLAY: Record<PackStatus, string> = {
  hero: 'Hero Pack',
  champion: "Champion's Pack",
  challenger: 'Challenger Pack',
}

// ── Division derivation ──────────────────────────────────────────────

function deriveDivision(pack: Pack | null, depth: number): string {
  if (pack?.division) return pack.division
  if (depth === 0) return 'Champion'
  if (depth === 1) return 'Frontline'
  return 'Mini'
}

// ── Classification derivation ────────────────────────────────────────

function deriveClassification(pack: Pack | null, role: string | null): string {
  if (pack?.classification) return pack.classification
  if (role === 'orchestrator') return 'Prompting'
  if (role === 'synthesis') return 'Closed Source'
  return 'Open Champion'
}

// ── Placement derivation ─────────────────────────────────────────────

function derivePlacement(stats: AgentStats | null, runStatus: string | null): string {
  if (stats && stats.totalRuns > 0) {
    if (stats.bestPlacement === 1) return '1st'
    if (stats.bestPlacement === 2) return '2nd'
    if (stats.bestPlacement === 3) return '3rd'
    if (stats.bestPlacement > 0) return `${stats.bestPlacement}th`
    return 'Competitor'
  }
  if (runStatus === 'running') return 'Finalist'
  if (runStatus === 'successful') return '1st'
  return 'Challenger'
}

// ── ThreadPower formula ──────────────────────────────────────────────
//
// Formula:  base + winBonus + podiumBonus + runVolumeBonus + statusBonus
// Capped at 9.9
//
function computeThreadPower(stats: AgentStats | null, runStatus: string | null, childCount: number): number {
  const base = 5.0

  if (stats && stats.totalRuns > 0) {
    const winRate = stats.wins / stats.totalRuns
    const winBonus = winRate * 2.5                                     // 0..2.5
    const podiumRate = stats.podiums / stats.totalRuns
    const podiumBonus = podiumRate * 1.2                               // 0..1.2
    const runVolumeBonus = Math.min(1.0, stats.totalRuns / 20)         // 0..1.0  (20 runs = max)
    const avgPlacementBonus = stats.avgPlacement > 0
      ? Math.max(0, (5 - stats.avgPlacement) * 0.15)                  // top-3 avg → 0.3..0.6
      : 0

    return Math.min(9.9, Number((base + winBonus + podiumBonus + runVolumeBonus + avgPlacementBonus).toFixed(1)))
  }

  // Fallback — no race data, derive from hierarchy context
  const childWeight = Math.min(childCount, 5)
  const statusBonus = runStatus === 'running' ? 0.6 : runStatus === 'successful' ? 0.9 : 0.2
  return Math.min(9.6, Number((6.2 + childWeight * 0.45 + statusBonus).toFixed(1)))
}

// ── Weight formula ───────────────────────────────────────────────────
//
// Formula:  base + podiumBonus + packBonus + depthBonus
// Capped at 9.9
//
function computeWeight(
  stats: AgentStats | null,
  pack: Pack | null,
  depth: number,
  childCount: number,
): number {
  const base = 4.0

  if (stats && stats.totalRuns > 0) {
    const podiumBonus = Math.min(2.5, stats.podiums * 0.5)             // 5 podiums = max
    const packBonus = pack
      ? pack.highestStatus === 'hero' ? 1.5
      : pack.highestStatus === 'champion' ? 1.0
      : 0.5
      : 0.3
    const depthBonus = depth === 0 ? 1.2 : depth === 1 ? 0.6 : 0.2

    return Math.min(9.9, Number((base + podiumBonus + packBonus + depthBonus).toFixed(1)))
  }

  // Fallback
  const childWeight = Math.min(childCount, 5)
  const depthBonus = depth === 0 ? 1.5 : depth === 1 ? 0.8 : 0.2
  return Math.min(9.4, Number((4.6 + childWeight * 0.55 + depthBonus).toFixed(1)))
}

// ── Delta string ─────────────────────────────────────────────────────

function computeDelta(stats: AgentStats | null, runStatus: string | null): string {
  if (stats && stats.totalRuns > 0) {
    const winRate = ((stats.wins / stats.totalRuns) * 100).toFixed(0)
    return `${winRate}% win rate across ${stats.totalRuns} runs`
  }
  if (runStatus === 'running') return '+0.9 from verified runs'
  return '+0.4 from successful runs'
}

// ── Rubric metrics ───────────────────────────────────────────────────

function computeRubric(
  stats: AgentStats | null,
  node: ProfileNodeContext,
): ThreadRubricMetric[] {
  if (stats && stats.totalRuns > 0) {
    const completionRate = stats.totalRuns > 0
      ? (stats.totalRuns - stats.disqualifications) / stats.totalRuns
      : 0
    const winRate = stats.wins / stats.totalRuns

    return [
      { label: 'Tools', value: Math.min(10, 5 + node.linkedSurfaceCount) },
      { label: 'Model', value: node.depth === 0 ? 8 : node.depth === 1 ? 7 : 6 },
      { label: 'Autonomy', value: node.role === 'orchestrator' ? 9 : node.role === 'synthesis' ? 7 : 6 },
      { label: 'Coordination', value: Math.min(10, 4 + node.childCount + (node.depth === 0 ? 2 : 0)) },
      { label: 'Reliability', value: Math.min(10, Math.round(completionRate * 10)) },
      { label: 'Economy', value: Math.min(10, Math.round(3 + winRate * 5 + (1 - (stats.avgPlacement / 10)) * 2)) },
    ]
  }

  // Fallback — same as original deriveProfile
  const childWeight = Math.min(node.childCount, 5)
  return [
    { label: 'Tools', value: Math.min(10, 5 + childWeight) },
    { label: 'Model', value: node.depth === 0 ? 8 : node.depth === 1 ? 7 : 6 },
    { label: 'Autonomy', value: node.role === 'orchestrator' ? 8 : 6 },
    { label: 'Coordination', value: Math.min(10, 4 + node.childCount + (node.depth === 0 ? 2 : 0)) },
    { label: 'Reliability', value: node.runStatus === 'successful' ? 8 : node.runStatus === 'running' ? 7 : 5 },
    { label: 'Economy', value: Math.max(3, 8 - childWeight) },
  ]
}

// ── Skills derivation ────────────────────────────────────────────────

function deriveSkills(agent: AgentRegistration | null): ThreadSkillBadge[] {
  // If agent has metadata.skills, use those
  if (agent?.metadata?.skills && Array.isArray(agent.metadata.skills)) {
    return (agent.metadata.skills as Array<{ id: string; label: string; inherited?: boolean }>).map(s => ({
      id: s.id,
      label: s.label,
      inherited: s.inherited ?? false,
    }))
  }

  // Default skill set
  return [
    { id: 'search', label: 'Search', inherited: false },
    { id: 'browser', label: 'Browser', inherited: false },
    { id: 'model', label: 'Model', inherited: false },
    { id: 'tools', label: 'Tools', inherited: false },
    { id: 'files', label: 'Files', inherited: true },
    { id: 'orchestration', label: 'Orchestration', inherited: true },
  ]
}

// ── Main profile builder ─────────────────────────────────────────────

/**
 * Build a ThreadCardProfile from real agent, pack, and race data.
 *
 * Degrades gracefully: when agent/pack/stats are null the function
 * falls back to the same algorithmic derivation that was used before
 * the registration system existed.
 */
export function buildAgentProfile(sources: ProfileDataSources): ThreadCardProfile {
  const { agent, stats, pack, node } = sources

  const division = deriveDivision(pack, node.depth)
  const classification = deriveClassification(pack, node.role)
  const placement = derivePlacement(stats, node.runStatus)
  const packName = pack ? PACK_DISPLAY[pack.highestStatus] : (
    placement === '1st' ? "Champion's Pack" : placement === 'Finalist' ? 'Hero Pack' : 'Challenger Pack'
  )

  const verified = agent != null && (
    (stats != null && stats.totalRuns > 0)
    || node.runStatus === 'running'
    || node.runStatus === 'successful'
  )

  return {
    builder: agent?.builderName ?? 'ThreadOS Registry',
    pack: packName,
    division,
    classification,
    placement,
    verified,
    threadPower: computeThreadPower(stats, node.runStatus, node.childCount),
    weight: computeWeight(stats, pack, node.depth, node.childCount),
    delta: computeDelta(stats, node.runStatus),
    rubric: computeRubric(stats, node),
    skills: deriveSkills(agent),
  }
}

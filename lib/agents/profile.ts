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

const ORDINAL_PLACEMENT: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd' }

function formatPlacement(placement: number): string {
  return ORDINAL_PLACEMENT[placement] ?? `${placement}th`
}

function derivePlacementFromStats(stats: AgentStats): string {
  if (stats.bestPlacement > 0) return formatPlacement(stats.bestPlacement)
  return 'Competitor'
}

const FALLBACK_PLACEMENT: Record<string, string> = { running: 'Finalist', successful: '1st' }

function derivePlacement(stats: AgentStats | null, runStatus: string | null): string {
  if (stats && stats.totalRuns > 0) return derivePlacementFromStats(stats)
  return FALLBACK_PLACEMENT[runStatus ?? ''] ?? 'Challenger'
}

// ── ThreadPower formula ──────────────────────────────────────────────
//
// Formula:  base + winBonus + podiumBonus + runVolumeBonus + statusBonus
// Capped at 9.9
//
function clampedScore(value: number, cap: number): number {
  return Math.min(cap, Number(value.toFixed(1)))
}

function threadPowerFromStats(stats: AgentStats): number {
  const base = 5.0
  const winBonus = (stats.wins / stats.totalRuns) * 2.5               // 0..2.5
  const podiumBonus = (stats.podiums / stats.totalRuns) * 1.2         // 0..1.2
  const runVolumeBonus = Math.min(1.0, stats.totalRuns / 20)          // 0..1.0  (20 runs = max)
  const avgPlacementBonus = stats.avgPlacement > 0
    ? Math.max(0, (5 - stats.avgPlacement) * 0.15)                    // top-3 avg → 0.3..0.6
    : 0
  return clampedScore(base + winBonus + podiumBonus + runVolumeBonus + avgPlacementBonus, 9.9)
}

const STATUS_BONUS: Record<string, number> = { running: 0.6, successful: 0.9 }

function threadPowerFallback(runStatus: string | null, childCount: number): number {
  const childWeight = Math.min(childCount, 5)
  const statusBonus = STATUS_BONUS[runStatus ?? ''] ?? 0.2
  return clampedScore(6.2 + childWeight * 0.45 + statusBonus, 9.6)
}

function computeThreadPower(stats: AgentStats | null, runStatus: string | null, childCount: number): number {
  if (stats && stats.totalRuns > 0) return threadPowerFromStats(stats)
  return threadPowerFallback(runStatus, childCount)
}

// ── Weight formula ───────────────────────────────────────────────────
//
// Formula:  base + podiumBonus + packBonus + depthBonus
// Capped at 9.9
//
const PACK_STATUS_BONUS: Record<string, number> = { hero: 1.5, champion: 1.0 }
const DEPTH_BONUS_WITH_STATS: Record<number, number> = { 0: 1.2, 1: 0.6 }
const DEPTH_BONUS_FALLBACK: Record<number, number> = { 0: 1.5, 1: 0.8 }

function packBonus(pack: Pack | null): number {
  if (!pack) return 0.3
  return PACK_STATUS_BONUS[pack.highestStatus] ?? 0.5
}

function weightFromStats(stats: AgentStats, pack: Pack | null, depth: number): number {
  const base = 4.0
  const podiumBonus = Math.min(2.5, stats.podiums * 0.5)
  const depthBonus = DEPTH_BONUS_WITH_STATS[depth] ?? 0.2
  return clampedScore(base + podiumBonus + packBonus(pack) + depthBonus, 9.9)
}

function weightFallback(depth: number, childCount: number): number {
  const childWeight = Math.min(childCount, 5)
  const depthBonus = DEPTH_BONUS_FALLBACK[depth] ?? 0.2
  return clampedScore(4.6 + childWeight * 0.55 + depthBonus, 9.4)
}

function computeWeight(
  stats: AgentStats | null,
  pack: Pack | null,
  depth: number,
  childCount: number,
): number {
  if (stats && stats.totalRuns > 0) return weightFromStats(stats, pack, depth)
  return weightFallback(depth, childCount)
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

const MODEL_BY_DEPTH: Record<number, number> = { 0: 8, 1: 7 }
const AUTONOMY_BY_ROLE: Record<string, number> = { orchestrator: 9, synthesis: 7 }
const AUTONOMY_FALLBACK_BY_ROLE: Record<string, number> = { orchestrator: 8 }
const RELIABILITY_BY_STATUS: Record<string, number> = { successful: 8, running: 7 }

function modelScore(depth: number): number {
  return MODEL_BY_DEPTH[depth] ?? 6
}

function coordinationScore(childCount: number, depth: number): number {
  return Math.min(10, 4 + childCount + (depth === 0 ? 2 : 0))
}

function rubricFromStats(stats: AgentStats, node: ProfileNodeContext): ThreadRubricMetric[] {
  const completionRate = (stats.totalRuns - stats.disqualifications) / stats.totalRuns
  const winRate = stats.wins / stats.totalRuns

  return [
    { label: 'Tools', value: Math.min(10, 5 + node.linkedSurfaceCount) },
    { label: 'Model', value: modelScore(node.depth) },
    { label: 'Autonomy', value: AUTONOMY_BY_ROLE[node.role ?? ''] ?? 6 },
    { label: 'Coordination', value: coordinationScore(node.childCount, node.depth) },
    { label: 'Reliability', value: Math.min(10, Math.round(completionRate * 10)) },
    { label: 'Economy', value: Math.min(10, Math.round(3 + winRate * 5 + (1 - (stats.avgPlacement / 10)) * 2)) },
  ]
}

function rubricFallback(node: ProfileNodeContext): ThreadRubricMetric[] {
  const childWeight = Math.min(node.childCount, 5)

  return [
    { label: 'Tools', value: Math.min(10, 5 + childWeight) },
    { label: 'Model', value: modelScore(node.depth) },
    { label: 'Autonomy', value: AUTONOMY_FALLBACK_BY_ROLE[node.role ?? ''] ?? 6 },
    { label: 'Coordination', value: coordinationScore(node.childCount, node.depth) },
    { label: 'Reliability', value: RELIABILITY_BY_STATUS[node.runStatus ?? ''] ?? 5 },
    { label: 'Economy', value: Math.max(3, 8 - childWeight) },
  ]
}

function computeRubric(
  stats: AgentStats | null,
  node: ProfileNodeContext,
): ThreadRubricMetric[] {
  if (stats && stats.totalRuns > 0) return rubricFromStats(stats, node)
  return rubricFallback(node)
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
const PLACEMENT_PACK_FALLBACK: Record<string, string> = {
  '1st': "Champion's Pack",
  'Finalist': 'Hero Pack',
}

function derivePackName(pack: Pack | null, placement: string): string {
  if (pack) return PACK_DISPLAY[pack.highestStatus]
  return PLACEMENT_PACK_FALLBACK[placement] ?? 'Challenger Pack'
}

function isVerifiedAgent(agent: AgentRegistration | null, stats: AgentStats | null, runStatus: string | null): boolean {
  if (agent == null) return false
  if (stats != null && stats.totalRuns > 0) return true
  return runStatus === 'running' || runStatus === 'successful'
}

export function buildAgentProfile(sources: ProfileDataSources): ThreadCardProfile {
  const { agent, stats, pack, node } = sources

  const placement = derivePlacement(stats, node.runStatus)

  return {
    builder: agent?.builderName ?? 'thredOS Registry',
    pack: derivePackName(pack, placement),
    division: deriveDivision(pack, node.depth),
    classification: deriveClassification(pack, node.role),
    placement,
    verified: isVerifiedAgent(agent, stats, node.runStatus),
    threadPower: computeThreadPower(stats, node.runStatus, node.childCount),
    weight: computeWeight(stats, pack, node.depth, node.childCount),
    delta: computeDelta(stats, node.runStatus),
    rubric: computeRubric(stats, node),
    skills: deriveSkills(agent),
  }
}

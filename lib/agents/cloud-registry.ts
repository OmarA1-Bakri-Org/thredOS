import { existsSync } from 'fs'
import { mkdir, readFile } from 'fs/promises'
import { join } from 'path'
import { writeFileAtomic } from '@/lib/fs/atomic'
import type { AgentRegistration } from './types'

const CLOUD_AGENT_REGISTRY_PATH = '.threados/state/cloud-agent-registry.json'

export interface CloudAgentRegistration {
  registrationNumber: string
  agentId: string
  identityHash: string
  version: number
  registeredAt: string
  supersedesRegistrationNumber: string | null
  name: string
  model: string
  role: string
  skillIds: string[]
  tools: string[]
}

export interface AgentPerformanceRecord {
  id: string
  registrationNumber: string
  recordedAt: string
  outcome: 'pass' | 'fail' | 'needs_review'
  durationMs: number | null
  qualityScore: number | null
  notes: string | null
}

interface CloudAgentRegistryState {
  version: 1
  registrations: CloudAgentRegistration[]
  performanceRecords: AgentPerformanceRecord[]
}

const DEFAULT_CLOUD_AGENT_REGISTRY_STATE: CloudAgentRegistryState = {
  version: 1,
  registrations: [],
  performanceRecords: [],
}

function buildRegistrationPrefix(date = new Date()): string {
  const year = date.getUTCFullYear()
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${date.getUTCDate()}`.padStart(2, '0')
  return `AG-${year}${month}${day}`
}

function createNextRegistrationNumber(existing: CloudAgentRegistration[]): string {
  const prefix = buildRegistrationPrefix()
  const todays = existing.filter(item => item.registrationNumber.startsWith(prefix))
  const nextIndex = todays.length + 1
  return `${prefix}-${`${nextIndex}`.padStart(4, '0')}`
}

export function getCloudAgentRegistryPath(basePath: string): string {
  return join(basePath, CLOUD_AGENT_REGISTRY_PATH)
}

export async function readCloudAgentRegistryState(basePath: string): Promise<CloudAgentRegistryState> {
  const fullPath = getCloudAgentRegistryPath(basePath)
  if (!existsSync(fullPath)) {
    return structuredClone(DEFAULT_CLOUD_AGENT_REGISTRY_STATE)
  }

  const raw = JSON.parse(await readFile(fullPath, 'utf-8')) as Partial<CloudAgentRegistryState>
  return {
    version: 1,
    registrations: Array.isArray(raw.registrations) ? raw.registrations : [],
    performanceRecords: Array.isArray(raw.performanceRecords) ? raw.performanceRecords : [],
  }
}

export async function writeCloudAgentRegistryState(basePath: string, state: CloudAgentRegistryState): Promise<void> {
  const fullPath = getCloudAgentRegistryPath(basePath)
  await mkdir(join(basePath, '.threados/state'), { recursive: true })
  await writeFileAtomic(fullPath, `${JSON.stringify(state, null, 2)}\n`)
}

function buildCloudRegistration(
  agent: AgentRegistration,
  existing: CloudAgentRegistration | null,
  priorRegistrationNumber: string | null,
): CloudAgentRegistration {
  const now = new Date().toISOString()
  return {
    registrationNumber: existing?.registrationNumber ?? createNextRegistrationNumber(existing ? [existing] : []),
    agentId: agent.id,
    identityHash: agent.composition?.identityHash ?? `${agent.id}:${agent.version ?? 1}`,
    version: agent.version ?? 1,
    registeredAt: existing?.registeredAt ?? now,
    supersedesRegistrationNumber: priorRegistrationNumber,
    name: agent.name,
    model: agent.model ?? 'unassigned',
    role: agent.role ?? 'unspecified',
    skillIds: (agent.skillRefs ?? []).map(skill => skill.id),
    tools: agent.tools ?? [],
  }
}

export async function registerCloudAgent(
  basePath: string,
  agent: AgentRegistration,
): Promise<CloudAgentRegistration> {
  const state = await readCloudAgentRegistryState(basePath)
  const existing = state.registrations.find(registration => registration.agentId === agent.id) ?? null
  const prior = agent.supersedesAgentId
    ? state.registrations.find(registration => registration.agentId === agent.supersedesAgentId) ?? null
    : null
  const candidate = buildCloudRegistration(agent, existing, prior?.registrationNumber ?? null)
  const registration = existing
    ? {
        ...existing,
        ...candidate,
      }
    : existing ?? {
        ...candidate,
        registrationNumber: createNextRegistrationNumber(state.registrations),
      }

  const nextState: CloudAgentRegistryState = {
    ...state,
    registrations: [
      ...state.registrations.filter(item => item.agentId !== agent.id),
      registration,
    ],
  }
  await writeCloudAgentRegistryState(basePath, nextState)
  return registration
}

export async function findCloudAgentRegistration(
  basePath: string,
  query: { agentId?: string | null; registrationNumber?: string | null },
): Promise<CloudAgentRegistration | null> {
  const state = await readCloudAgentRegistryState(basePath)
  if (query.registrationNumber) {
    return state.registrations.find(item => item.registrationNumber === query.registrationNumber) ?? null
  }
  if (query.agentId) {
    return state.registrations.find(item => item.agentId === query.agentId) ?? null
  }
  return null
}

export async function recordCloudAgentPerformance(
  basePath: string,
  input: Omit<AgentPerformanceRecord, 'id' | 'recordedAt'> & { id?: string; recordedAt?: string },
): Promise<AgentPerformanceRecord> {
  const state = await readCloudAgentRegistryState(basePath)
  const nextRecord: AgentPerformanceRecord = {
    id: input.id ?? `perf-${Date.now()}`,
    registrationNumber: input.registrationNumber,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
    outcome: input.outcome,
    durationMs: input.durationMs ?? null,
    qualityScore: input.qualityScore ?? null,
    notes: input.notes ?? null,
  }

  const nextState: CloudAgentRegistryState = {
    ...state,
    performanceRecords: [...state.performanceRecords, nextRecord],
  }
  await writeCloudAgentRegistryState(basePath, nextState)
  return nextRecord
}

export async function listCloudAgentPerformance(
  basePath: string,
  registrationNumber: string,
): Promise<AgentPerformanceRecord[]> {
  const state = await readCloudAgentRegistryState(basePath)
  return state.performanceRecords
    .filter(record => record.registrationNumber === registrationNumber)
    .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt))
}

export async function summarizeCloudAgentPerformance(
  basePath: string,
  registrationNumber: string,
): Promise<{ totalRuns: number; passRate: number; avgTimeMs: number; quality: number } | null> {
  const records = await listCloudAgentPerformance(basePath, registrationNumber)
  if (records.length === 0) return null

  const totalRuns = records.length
  const passingRuns = records.filter(record => record.outcome === 'pass').length
  const durationRuns = records.filter(record => typeof record.durationMs === 'number')
  const qualityRuns = records.filter(record => typeof record.qualityScore === 'number')

  const avgTimeMs = durationRuns.length > 0
    ? Math.round(durationRuns.reduce((sum, record) => sum + (record.durationMs ?? 0), 0) / durationRuns.length)
    : 0
  const quality = qualityRuns.length > 0
    ? Math.round(qualityRuns.reduce((sum, record) => sum + (record.qualityScore ?? 0), 0) / qualityRuns.length)
    : 0

  return {
    totalRuns,
    passRate: Math.round((passingRuns / totalRuns) * 100),
    avgTimeMs,
    quality,
  }
}

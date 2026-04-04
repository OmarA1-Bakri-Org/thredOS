import { existsSync } from 'fs'
import { mkdir, readFile } from 'fs/promises'
import { join } from 'path'
import { writeFileAtomic } from '@/lib/fs/atomic'
import type { AgentRegistration } from './types'
import {
  sanitizeAgentForCloud,
  type CloudAgentRegistrationPayload,
} from '@/lib/local-first/cloud-boundary'

const CLOUD_AGENT_REGISTRY_PATH = '.threados/state/cloud-agent-registry.json'

export type CloudAgentRegistration = CloudAgentRegistrationPayload

interface CloudAgentRegistryState {
  version: 1
  registrations: CloudAgentRegistration[]
}

const DEFAULT_CLOUD_AGENT_REGISTRY_STATE: CloudAgentRegistryState = {
  version: 1,
  registrations: [],
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
  return sanitizeAgentForCloud(agent, {
    registrationNumber: existing?.registrationNumber ?? createNextRegistrationNumber(existing ? [existing] : []),
    identityHash: agent.composition?.identityHash ?? `${agent.id}:${agent.version ?? 1}`,
    version: agent.version ?? 1,
    registeredAt: existing?.registeredAt ?? now,
    supersedesRegistrationNumber: priorRegistrationNumber,
  })
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

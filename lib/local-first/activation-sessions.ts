import { existsSync } from 'fs'
import { mkdir, readFile } from 'fs/promises'
import { join } from 'path'
import { writeFileAtomic } from '@/lib/fs/atomic'
import type { ActivationSession } from './types'

const ACTIVATION_SESSION_STATE_PATH = '.threados/state/desktop-activation-sessions.json'

export type ActivationSessionStatus =
  | 'created'
  | 'checkout_started'
  | 'checkout_completed'
  | 'activated'
  | 'cancelled'

export interface PendingActivationSession extends ActivationSession {
  status: ActivationSessionStatus
  plan: 'desktop-public-beta'
  createdAt: string
  updatedAt: string
  customerEmail: string | null
  checkoutSessionId: string | null
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  activationToken: string | null
}

interface ActivationSessionState {
  version: 1
  sessions: PendingActivationSession[]
}

const DEFAULT_STATE: ActivationSessionState = {
  version: 1,
  sessions: [],
}

function getStatePath(basePath: string): string {
  return join(basePath, ACTIVATION_SESSION_STATE_PATH)
}

async function readActivationState(basePath: string): Promise<ActivationSessionState> {
  const fullPath = getStatePath(basePath)
  if (!existsSync(fullPath)) {
    return structuredClone(DEFAULT_STATE)
  }

  const raw = JSON.parse(await readFile(fullPath, 'utf-8')) as Partial<ActivationSessionState>
  return {
    version: 1,
    sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
  }
}

async function writeActivationState(basePath: string, state: ActivationSessionState): Promise<void> {
  const fullPath = getStatePath(basePath)
  await mkdir(join(basePath, '.threados/state'), { recursive: true })
  await writeFileAtomic(fullPath, `${JSON.stringify(state, null, 2)}\n`)
}

export async function createActivationSession(
  basePath: string,
  input: Omit<PendingActivationSession, 'createdAt' | 'updatedAt'>,
): Promise<PendingActivationSession> {
  const state = await readActivationState(basePath)
  const now = new Date().toISOString()
  const session: PendingActivationSession = {
    ...input,
    createdAt: now,
    updatedAt: now,
  }

  await writeActivationState(basePath, {
    ...state,
    sessions: [...state.sessions.filter(item => item.state !== session.state), session],
  })
  return session
}

export async function readActivationSession(
  basePath: string,
  stateId: string,
): Promise<PendingActivationSession | null> {
  const state = await readActivationState(basePath)
  return state.sessions.find(item => item.state === stateId) ?? null
}

export async function updateActivationSession(
  basePath: string,
  stateId: string,
  updater: (session: PendingActivationSession) => PendingActivationSession,
): Promise<PendingActivationSession | null> {
  const state = await readActivationState(basePath)
  const existing = state.sessions.find(item => item.state === stateId)
  if (!existing) return null

  const nextSession = {
    ...updater(existing),
    updatedAt: new Date().toISOString(),
  }
  await writeActivationState(basePath, {
    ...state,
    sessions: state.sessions.map(item => item.state === stateId ? nextSession : item),
  })
  return nextSession
}

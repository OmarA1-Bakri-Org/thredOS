import { createHmac, timingSafeEqual } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, readFile } from 'fs/promises'
import { join } from 'path'
import { writeFileAtomic } from '@/lib/fs/atomic'
import type { ActivationTokenPayload, EntitlementState, EntitlementStatus } from './types'

const ENTITLEMENT_STATE_PATH = '.threados/state/desktop-entitlement.json'
const DEFAULT_GRACE_PERIOD_DAYS = 14

const DEFAULT_ENTITLEMENT_STATE: EntitlementState = {
  status: 'inactive',
  plan: 'desktop-public-beta',
  customerEmail: null,
  activatedAt: null,
  lastValidatedAt: null,
  expiresAt: null,
  graceUntil: null,
  activationSource: 'development',
}

export interface EntitlementSnapshot {
  state: EntitlementState
  effectiveStatus: EntitlementStatus
  isUsable: boolean
}

export function getEntitlementStatePath(basePath: string): string {
  return join(basePath, ENTITLEMENT_STATE_PATH)
}

export async function readLocalEntitlement(basePath: string): Promise<EntitlementState> {
  const fullPath = getEntitlementStatePath(basePath)
  if (!existsSync(fullPath)) {
    return structuredClone(DEFAULT_ENTITLEMENT_STATE)
  }

  const raw = JSON.parse(await readFile(fullPath, 'utf-8')) as Partial<EntitlementState>
  return {
    status: raw.status ?? DEFAULT_ENTITLEMENT_STATE.status,
    plan: 'desktop-public-beta',
    customerEmail: raw.customerEmail ?? null,
    activatedAt: raw.activatedAt ?? null,
    lastValidatedAt: raw.lastValidatedAt ?? null,
    expiresAt: raw.expiresAt ?? null,
    graceUntil: raw.graceUntil ?? null,
    activationSource: raw.activationSource ?? DEFAULT_ENTITLEMENT_STATE.activationSource,
  }
}

export async function writeLocalEntitlement(basePath: string, state: EntitlementState): Promise<void> {
  const fullPath = getEntitlementStatePath(basePath)
  await mkdir(join(basePath, '.threados/state'), { recursive: true })
  await writeFileAtomic(fullPath, `${JSON.stringify(state, null, 2)}\n`)
}

function parseIsoDate(value: string | null): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

export function getEffectiveEntitlementState(state: EntitlementState, now = Date.now()): EntitlementSnapshot {
  if (state.status === 'active') {
    const expiresAt = parseIsoDate(state.expiresAt)
    if (expiresAt != null && expiresAt <= now) {
      const graceUntil = parseIsoDate(state.graceUntil)
      if (graceUntil != null && graceUntil > now) {
        return { state, effectiveStatus: 'grace', isUsable: true }
      }
      return { state, effectiveStatus: 'expired', isUsable: false }
    }
    return { state, effectiveStatus: 'active', isUsable: true }
  }

  if (state.status === 'grace') {
    const graceUntil = parseIsoDate(state.graceUntil)
    if (graceUntil != null && graceUntil > now) {
      return { state, effectiveStatus: 'grace', isUsable: true }
    }
    return { state, effectiveStatus: 'expired', isUsable: false }
  }

  if (state.status === 'pending') {
    return { state, effectiveStatus: 'pending', isUsable: false }
  }

  if (state.status === 'expired') {
    return { state, effectiveStatus: 'expired', isUsable: false }
  }

  return { state, effectiveStatus: 'inactive', isUsable: false }
}

function getActivationSecret(): string {
  return process.env.THREDOS_ACTIVATION_SECRET
    ?? process.env.THREADOS_ACTIVATION_SECRET
    ?? 'local-dev-activation-secret'
}

function signActivationPayload(payload: string): string {
  return createHmac('sha256', getActivationSecret()).update(payload).digest('base64url')
}

export function issueActivationToken(payload: ActivationTokenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url')
  return `${encoded}.${signActivationPayload(encoded)}`
}

export function verifyActivationToken(token: string): ActivationTokenPayload | null {
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null

  const expectedSignature = signActivationPayload(payload)
  const actual = Buffer.from(signature)
  const expected = Buffer.from(expectedSignature)
  if (actual.length !== expected.length) return null
  if (!timingSafeEqual(actual, expected)) return null

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as ActivationTokenPayload
  } catch {
    return null
  }
}

export function createEntitlementFromActivation(
  payload: ActivationTokenPayload,
  activationSource: EntitlementState['activationSource'] = 'browser-return',
): EntitlementState {
  return {
    status: payload.status,
    plan: payload.plan,
    customerEmail: payload.customerEmail,
    activatedAt: payload.activatedAt,
    lastValidatedAt: payload.lastValidatedAt,
    expiresAt: payload.expiresAt,
    graceUntil: payload.graceUntil,
    activationSource,
  }
}

export async function activateLocalEntitlement(
  basePath: string,
  payload: ActivationTokenPayload,
  activationSource: EntitlementState['activationSource'] = 'browser-return',
): Promise<EntitlementState> {
  const state = createEntitlementFromActivation(payload, activationSource)
  await writeLocalEntitlement(basePath, state)
  return state
}

export async function refreshLocalEntitlement(basePath: string): Promise<EntitlementState> {
  const current = await readLocalEntitlement(basePath)
  const nowIso = new Date().toISOString()

  if (current.status === 'active' || current.status === 'grace') {
    const expiresAt = current.expiresAt ?? null
    const graceUntil = current.graceUntil
      ?? new Date(Date.now() + DEFAULT_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString()

    const nextState: EntitlementState = {
      ...current,
      lastValidatedAt: nowIso,
      expiresAt,
      graceUntil,
    }
    await writeLocalEntitlement(basePath, nextState)
    return nextState
  }

  const nextState: EntitlementState = {
    ...current,
    lastValidatedAt: nowIso,
  }
  await writeLocalEntitlement(basePath, nextState)
  return nextState
}

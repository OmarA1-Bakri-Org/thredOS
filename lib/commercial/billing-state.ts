import { existsSync } from 'fs'
import { mkdir, readFile } from 'fs/promises'
import { join } from 'path'
import { writeFileAtomic } from '@/lib/fs/atomic'
import type { EntitlementStatus } from '@/lib/local-first/types'

const BILLING_STATE_PATH = '.threados/state/desktop-billing.json'

export interface BillingEntitlementRecord {
  state: string
  plan: 'desktop-public-beta'
  customerEmail: string | null
  checkoutSessionId: string | null
  customerId: string | null
  subscriptionId: string | null
  subscriptionStatus: string | null
  entitlementStatus: EntitlementStatus
  activatedAt: string | null
  expiresAt: string | null
  graceUntil: string | null
  updatedAt: string
  source: 'checkout-resolve' | 'stripe-webhook'
}

interface BillingState {
  version: 1
  entitlements: BillingEntitlementRecord[]
  processedEventIds: string[]
}

const DEFAULT_BILLING_STATE: BillingState = {
  version: 1,
  entitlements: [],
  processedEventIds: [],
}

function getBillingStatePath(basePath: string): string {
  return join(basePath, BILLING_STATE_PATH)
}

export async function readBillingState(basePath: string): Promise<BillingState> {
  const fullPath = getBillingStatePath(basePath)
  if (!existsSync(fullPath)) {
    return structuredClone(DEFAULT_BILLING_STATE)
  }

  const raw = JSON.parse(await readFile(fullPath, 'utf-8')) as Partial<BillingState>
  return {
    version: 1,
    entitlements: Array.isArray(raw.entitlements) ? raw.entitlements : [],
    processedEventIds: Array.isArray(raw.processedEventIds) ? raw.processedEventIds : [],
  }
}

async function writeBillingState(basePath: string, state: BillingState): Promise<void> {
  const fullPath = getBillingStatePath(basePath)
  await mkdir(join(basePath, '.threados/state'), { recursive: true })
  await writeFileAtomic(fullPath, `${JSON.stringify(state, null, 2)}\n`)
}

export async function upsertBillingEntitlement(
  basePath: string,
  record: BillingEntitlementRecord,
): Promise<BillingEntitlementRecord> {
  const state = await readBillingState(basePath)
  const nextEntitlements = [
    ...state.entitlements.filter(item =>
      item.state !== record.state
      && (!record.subscriptionId || item.subscriptionId !== record.subscriptionId),
    ),
    record,
  ]

  await writeBillingState(basePath, {
    ...state,
    entitlements: nextEntitlements,
  })
  return record
}

export async function markBillingEventProcessed(basePath: string, eventId: string): Promise<boolean> {
  const state = await readBillingState(basePath)
  if (state.processedEventIds.includes(eventId)) {
    return false
  }

  await writeBillingState(basePath, {
    ...state,
    processedEventIds: [...state.processedEventIds, eventId],
  })
  return true
}

export async function hasProcessedBillingEvent(basePath: string, eventId: string): Promise<boolean> {
  const state = await readBillingState(basePath)
  return state.processedEventIds.includes(eventId)
}

export async function findBillingEntitlement(
  basePath: string,
  query: { state?: string | null; subscriptionId?: string | null },
): Promise<BillingEntitlementRecord | null> {
  const state = await readBillingState(basePath)
  if (query.state) {
    return state.entitlements.find(item => item.state === query.state) ?? null
  }
  if (query.subscriptionId) {
    return state.entitlements.find(item => item.subscriptionId === query.subscriptionId) ?? null
  }
  return null
}

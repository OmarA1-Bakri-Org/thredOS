export const LOCAL_ONLY_DATA_CLASSES = [
  'workspace-files',
  'prompt-markdown',
  'skill-markdown',
  'sequence-state',
  'thread-surfaces',
  'runtime-logs',
  'artifacts',
  'provenance',
  'workflow-content',
] as const

export const CLOUD_ONLY_DATA_CLASSES = [
  'account-identity',
  'billing-state',
  'activation-state',
  'agent-registration',
  'agent-performance',
] as const

export type LocalOnlyDataClass = typeof LOCAL_ONLY_DATA_CLASSES[number]
export type CloudOnlyDataClass = typeof CLOUD_ONLY_DATA_CLASSES[number]

export interface LocalWorkspace {
  id: string
  label: string
  basePath: string
  createdAt: string
  lastOpenedAt: string
  runtimeTarget: 'desktop' | 'node'
  dataResidency: 'local-only'
}

export type EntitlementStatus = 'inactive' | 'pending' | 'active' | 'grace' | 'expired'

export interface EntitlementState {
  status: EntitlementStatus
  plan: 'desktop-public-beta'
  customerEmail: string | null
  activatedAt: string | null
  lastValidatedAt: string | null
  expiresAt: string | null
  graceUntil: string | null
  activationSource: 'browser-return' | 'manual' | 'development'
}

export interface ActivationSession {
  state: string
  authUrl: string
  checkoutUrl: string | null
  returnUrl: string
  localAppUrl: string
}

export interface ActivationTokenPayload {
  customerEmail: string
  plan: EntitlementState['plan']
  status: Extract<EntitlementStatus, 'active' | 'grace'>
  activatedAt: string
  lastValidatedAt: string
  expiresAt: string | null
  graceUntil: string | null
}

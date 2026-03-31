function readEnv(...keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key]?.trim()
    if (value) return value
  }
  return null
}

function isTruthy(value: string | null): boolean {
  if (!value) return false
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

export function isVerificationMode(): boolean {
  return isTruthy(readEnv('THREDOS_VERIFICATION_MODE', 'THREADOS_VERIFICATION_MODE'))
}

export function isClientVerificationMode(): boolean {
  return isTruthy(readEnv(
    'NEXT_PUBLIC_THREDOS_VERIFICATION_MODE',
    'NEXT_PUBLIC_THREADOS_VERIFICATION_MODE',
    'THREDOS_VERIFICATION_MODE',
    'THREADOS_VERIFICATION_MODE',
  ))
}

export function shouldUseStubStripeBoundary(): boolean {
  return readEnv('THREDOS_VERIFICATION_STRIPE_MODE', 'THREADOS_VERIFICATION_STRIPE_MODE') === 'stub'
}

export function getVerificationEmail(): string {
  return readEnv('THREDOS_VERIFY_EMAIL', 'THREADOS_VERIFY_EMAIL') ?? 'verifier@thredos.local'
}

export function buildVerificationCheckoutSessionId(state: string): string {
  return `verify_cs_${state}`
}

export function parseVerificationCheckoutSessionId(sessionId: string): string | null {
  const prefix = 'verify_cs_'
  return sessionId.startsWith(prefix) ? sessionId.slice(prefix.length) : null
}

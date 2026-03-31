import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

const originalEnv = {
  THREDOS_VERIFICATION_STRIPE_MODE: process.env.THREDOS_VERIFICATION_STRIPE_MODE,
  THREADOS_VERIFICATION_STRIPE_MODE: process.env.THREADOS_VERIFICATION_STRIPE_MODE,
  THREDOS_VERIFY_EMAIL: process.env.THREDOS_VERIFY_EMAIL,
  THREADOS_VERIFY_EMAIL: process.env.THREADOS_VERIFY_EMAIL,
}

beforeEach(() => {
  process.env.THREDOS_VERIFICATION_STRIPE_MODE = 'stub'
  process.env.THREDOS_VERIFY_EMAIL = 'verifier@thredos.local'
  delete process.env.THREADOS_VERIFICATION_STRIPE_MODE
  delete process.env.THREADOS_VERIFY_EMAIL
})

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

const stripeModule = await import('./stripe')

describe('commercial stripe verification stub', () => {
  test('createDesktopCheckoutSession returns the mock checkout route in verification mode', async () => {
    const session = await stripeModule.createDesktopCheckoutSession({
      origin: 'http://127.0.0.1:4301',
      state: 'verify-state',
      customerEmail: 'verifier@thredos.local',
      plan: 'desktop-public-beta',
    })

    expect(session.id).toBe('verify_cs_verify-state')
    expect(session.url).toContain('/desktop/checkout/mock')
    expect(session.url).toContain('state=verify-state')
    expect(session.url).toContain('session_id=verify_cs_verify-state')
  })

  test('resolveDesktopCheckoutSession returns an active entitlement payload in verification mode', async () => {
    const resolution = await stripeModule.resolveDesktopCheckoutSession('verify_cs_verify-state', {
      stateId: 'verify-state',
      customerEmail: 'verifier@thredos.local',
    })

    expect(resolution.entitlementStatus).toBe('active')
    expect(resolution.payload.customerEmail).toBe('verifier@thredos.local')
    expect(resolution.payload.status).toBe('active')
    expect(resolution.session.client_reference_id).toBe('verify-state')
  })
})

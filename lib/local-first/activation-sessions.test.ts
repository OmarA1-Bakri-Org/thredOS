import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { createActivationSession, readActivationSession, updateActivationSession } from './activation-sessions'

let basePath = ''

beforeAll(async () => {
  basePath = await mkdtemp(join(tmpdir(), 'thredos-activation-session-'))
})

afterAll(async () => {
  await rm(basePath, { recursive: true, force: true })
})

describe('activation sessions', () => {
  test('create and update activation session state', async () => {
    const session = await createActivationSession(basePath, {
      state: 'state-1',
      authUrl: 'https://example.com/sign-in',
      checkoutUrl: null,
      returnUrl: 'thredos://activate',
      localAppUrl: 'http://127.0.0.1:3010/app',
      status: 'created',
      plan: 'desktop-public-beta',
      customerEmail: 'founder@example.com',
      checkoutSessionId: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      activationToken: null,
    })

    expect(session.status).toBe('created')

    const updated = await updateActivationSession(basePath, 'state-1', current => ({
      ...current,
      status: 'checkout_started',
      checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_123',
      checkoutSessionId: 'cs_test_123',
    }))

    expect(updated?.status).toBe('checkout_started')

    const stored = await readActivationSession(basePath, 'state-1')
    expect(stored?.checkoutSessionId).toBe('cs_test_123')
  })
})

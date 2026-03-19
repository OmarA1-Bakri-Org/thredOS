import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  activateLocalEntitlement,
  getEffectiveEntitlementState,
  issueActivationToken,
  readLocalEntitlement,
  verifyActivationToken,
} from './entitlements'

const tempDirs: string[] = []

async function createTempWorkspace() {
  const dir = await mkdtemp(join(tmpdir(), 'thredos-entitlement-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) {
      await rm(dir, { recursive: true, force: true })
    }
  }
})

describe('local entitlements', () => {
  test('issues and verifies an activation token', () => {
    const token = issueActivationToken({
      customerEmail: 'operator@thredos.dev',
      plan: 'desktop-public-beta',
      status: 'active',
      activatedAt: '2026-03-19T00:00:00.000Z',
      lastValidatedAt: '2026-03-19T00:00:00.000Z',
      expiresAt: null,
      graceUntil: '2026-04-02T00:00:00.000Z',
    })

    expect(verifyActivationToken(token)).toEqual({
      customerEmail: 'operator@thredos.dev',
      plan: 'desktop-public-beta',
      status: 'active',
      activatedAt: '2026-03-19T00:00:00.000Z',
      lastValidatedAt: '2026-03-19T00:00:00.000Z',
      expiresAt: null,
      graceUntil: '2026-04-02T00:00:00.000Z',
    })
  })

  test('activates and persists a local entitlement with usable state', async () => {
    const workspace = await createTempWorkspace()
    await activateLocalEntitlement(workspace, {
      customerEmail: 'operator@thredos.dev',
      plan: 'desktop-public-beta',
      status: 'active',
      activatedAt: '2026-03-19T00:00:00.000Z',
      lastValidatedAt: '2026-03-19T00:00:00.000Z',
      expiresAt: null,
      graceUntil: '2026-04-02T00:00:00.000Z',
    })

    const state = await readLocalEntitlement(workspace)
    const snapshot = getEffectiveEntitlementState(state)

    expect(state.customerEmail).toBe('operator@thredos.dev')
    expect(snapshot.effectiveStatus).toBe('active')
    expect(snapshot.isUsable).toBe(true)
  })
})

import { mkdir, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { request as playwrightRequest } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${process.env.PLAYWRIGHT_PORT ?? '4301'}`
const ARTIFACTS_DIR = process.env.PLAYWRIGHT_ARTIFACTS_DIR ?? 'test-results/verify/manual'
const STORAGE_STATE_PATH = process.env.PLAYWRIGHT_STORAGE_STATE_PATH ?? join(ARTIFACTS_DIR, 'auth-storage-state.json')

async function seedAuthenticatedStorageState() {
  const context = await playwrightRequest.newContext({
    baseURL: BASE_URL,
  })

  try {
    const response = await context.post('/api/auth/login', {
      data: {
        email: process.env.THREDOS_VERIFY_EMAIL ?? 'verifier@thredos.local',
        password: process.env.THREDOS_VERIFY_PASSWORD ?? 'thredos-verify-password',
        next: '/app',
      },
    })

    if (!response.ok()) {
      throw new Error(`Failed to seed verification auth state: ${response.status()} ${await response.text()}`)
    }

    await Promise.allSettled([
      context.get('/app'),
      context.get('/api/status'),
      context.get('/api/sequence'),
      context.get('/api/thread-surfaces'),
      context.get('/api/agents'),
    ])

    await mkdir(dirname(STORAGE_STATE_PATH), { recursive: true })
    await context.storageState({ path: STORAGE_STATE_PATH })
  } finally {
    await context.dispose()
  }
}

async function probe(pathname: string) {
  const url = new URL(pathname, BASE_URL).toString()
  let lastStatus = 0
  let lastLocation: string | null = null

  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: 'manual' })
      lastStatus = response.status
      lastLocation = response.headers.get('location')
      if (response.status >= 200 && response.status < 400) {
        return {
          url,
          status: response.status,
          location: lastLocation,
        }
      }
    } catch {
      // Continue probing until timeout.
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  throw new Error(`Readiness probe failed for ${url} (last status: ${lastStatus}${lastLocation ? `, location: ${lastLocation}` : ''})`)
}

export default async function globalSetup() {
  await seedAuthenticatedStorageState()
  const readiness = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    checks: await Promise.all([
      probe('/'),
      probe('/app'),
    ]),
  }

  const outputPath = join(ARTIFACTS_DIR, 'readiness.json')
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(readiness, null, 2)}\n`, 'utf8')
}

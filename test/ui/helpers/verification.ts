import { mkdir, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { expect, type Page, type Response, type TestInfo } from '@playwright/test'

export type VerificationBoundary =
  | 'UI'
  | 'client -> API'
  | 'API -> data'
  | 'data -> response'
  | 'response -> UI'

interface BoundaryTrace {
  boundary: VerificationBoundary
  label: string
  status: 'passed' | 'failed'
  startedAt: string
  completedAt: string
  error?: string
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

export function getVerificationCredentials() {
  return {
    email: process.env.THREDOS_VERIFY_EMAIL ?? 'verifier@thredos.local',
    password: process.env.THREDOS_VERIFY_PASSWORD ?? 'thredos-verify-password',
  }
}

export function getVerificationBaseUrl() {
  return process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${process.env.PLAYWRIGHT_PORT ?? '4301'}`
}

export async function browserFetchJson<T = unknown>(
  page: Page,
  pathname: string,
  init: RequestInit = {},
): Promise<{ ok: boolean, status: number, body: T | string | null }> {
  return await page.evaluate(async ({ pathname: path, init: requestInit }) => {
    const response = await fetch(new URL(path, window.location.origin).toString(), {
      credentials: 'include',
      ...requestInit,
    })
    const text = await response.text()
    let body: unknown = null
    if (text) {
      try {
        body = JSON.parse(text) as unknown
      } catch {
        body = text
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      body: body as T | string | null,
    }
  }, {
    pathname,
    init,
  })
}

export function startBrowserEvidence(page: Page, testInfo: TestInfo, suiteName: string) {
  const consoleMessages: Array<Record<string, unknown>> = []
  const pageErrors: string[] = []
  const failedRequests: Array<Record<string, unknown>> = []
  const failedResponses: Array<Record<string, unknown>> = []
  const boundaryTraces: BoundaryTrace[] = []

  page.on('console', message => {
    consoleMessages.push({
      type: message.type(),
      text: message.text(),
      location: message.location(),
    })
  })
  page.on('pageerror', error => {
    pageErrors.push(error.message)
  })
  page.on('requestfailed', request => {
    failedRequests.push({
      url: request.url(),
      method: request.method(),
      errorText: request.failure()?.errorText ?? null,
    })
  })
  page.on('response', response => {
    if (response.status() >= 400) {
      failedResponses.push({
        url: response.url(),
        status: response.status(),
        method: response.request().method(),
      })
    }
  })

  async function withinBoundary<T>(
    boundary: VerificationBoundary,
    label: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const entry: BoundaryTrace = {
      boundary,
      label,
      status: 'passed',
      startedAt: new Date().toISOString(),
      completedAt: '',
    }
    boundaryTraces.push(entry)

    try {
      const result = await action()
      entry.completedAt = new Date().toISOString()
      return result
    } catch (error) {
      entry.status = 'failed'
      entry.completedAt = new Date().toISOString()
      entry.error = error instanceof Error ? error.message : String(error)
      throw error
    }
  }

  async function finalize() {
    const slug = slugify(suiteName)
    const screenshotPath = testInfo.outputPath(`${slug}.png`)
    const consolePath = testInfo.outputPath(`${slug}.console.json`)
    const failuresPath = testInfo.outputPath(`${slug}.failures.json`)
    const boundariesPath = testInfo.outputPath(`${slug}.boundaries.json`)

    await mkdir(dirname(consolePath), { recursive: true })
    await writeFile(consolePath, `${JSON.stringify({
      consoleMessages,
      pageErrors,
    }, null, 2)}\n`, 'utf8')
    await writeFile(failuresPath, `${JSON.stringify({
        failedRequests,
        failedResponses,
      }, null, 2)}\n`, 'utf8')
    await writeFile(boundariesPath, `${JSON.stringify({
      suiteName,
      boundaries: boundaryTraces,
    }, null, 2)}\n`, 'utf8')

    try {
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
        animations: 'disabled',
      })
      await testInfo.attach('screenshot', {
        path: screenshotPath,
        contentType: 'image/png',
      })
    } catch {
      // Ignore screenshot capture failures if the page is already gone.
    }

    await testInfo.attach('console-log', {
      path: consolePath,
      contentType: 'application/json',
    })
    await testInfo.attach('network-failures', {
      path: failuresPath,
      contentType: 'application/json',
    })
    await testInfo.attach('boundary-trace', {
      path: boundariesPath,
      contentType: 'application/json',
    })
  }

  return {
    finalize,
    withinBoundary,
  }
}

export async function expectNoFrameworkOverlay(page: Page) {
  await expect(page.locator('[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay')).toHaveCount(0)
  const hasContent = await page.evaluate(() => document.body.innerText.trim().length > 0)
  expect(hasContent).toBe(true)
}

async function waitForWorkbenchShellOnce(page: Page) {
  await expect(page).toHaveURL(/\/app(?:[?#].*)?$/, { timeout: 30_000 })
  await expect(page.locator('[data-workbench-region="top-bar"]')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-workbench-region="accordion-panel"]')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('topbar-status-summary')).toBeVisible({ timeout: 30_000 })
  await expectNoFrameworkOverlay(page)
}

export async function waitForWorkbenchShell(page: Page) {
  try {
    await waitForWorkbenchShellOnce(page)
  } catch {
    // In dev mode Next can finish an HMR rebuild after /app resolves but before the shell mounts.
    // One reload recovers the shell without hiding persistent failures.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitForWorkbenchShellOnce(page)
    return
  }
}

export async function submitVerifierCredentials(page: Page): Promise<Response> {
  const { email, password } = getVerificationCredentials()
  await expect(page.getByTestId('login-form')).toBeVisible()
  await page.getByTestId('login-email').fill(email)
  await page.getByTestId('login-password').fill(password)
  const responsePromise = page.waitForResponse(response =>
    response.url().endsWith('/api/auth/login') && response.request().method() === 'POST',
  )
  await page.getByTestId('login-submit').click()
  return await responsePromise
}

export async function loginAsVerifier(page: Page) {
  await page.goto('/login?next=/app')
  await expect(page.getByRole('heading', { name: 'Activate thredOS Desktop.' })).toBeVisible({ timeout: 15_000 })
  const response = await submitVerifierCredentials(page)
  expect(response.ok(), `Verifier login failed with status ${response.status()}`).toBe(true)
  await waitForWorkbenchShell(page)
}

export async function openAuthenticatedWorkbench(page: Page) {
  await page.goto('/app')
  if (new URL(page.url()).pathname === '/login') {
    await expect(page.getByRole('heading', { name: 'Activate thredOS Desktop.' })).toBeVisible({ timeout: 15_000 })
    const response = await submitVerifierCredentials(page)
    expect(response.ok(), `Verifier login failed with status ${response.status()}`).toBe(true)
  }
  await waitForWorkbenchShell(page)
}

export async function openAccordionSection(page: Page, key: string) {
  const openSection = page.getByTestId(`accordion-open-${key}`)
  if (!(await openSection.isVisible().catch(() => false))) {
    await page.getByTestId(`accordion-tab-${key}`).click()
  }
  await expect(openSection).toBeVisible()
}

export async function selectFirstPhase(page: Page) {
  await openAccordionSection(page, 'phase')
  const phaseOptions = page.locator('[data-testid^="phase-option-"]')
  await expect(phaseOptions.first()).toBeVisible()
  await phaseOptions.first().click()
}

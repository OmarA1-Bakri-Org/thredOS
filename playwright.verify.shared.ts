import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test'
import { statSync } from 'fs'
import { isAbsolute } from 'path'
import { createPlaywrightServerSettings } from './scripts/verify/runtime-helpers.mjs'

type VerifyMode = 'local' | 'ci' | 'ui' | 'release-live'

interface VerifyConfigOptions {
  mode: VerifyMode
  testMatch: string | string[]
  webServerCommand?: string
}

const ARTIFACTS_DIR = process.env.PLAYWRIGHT_ARTIFACTS_DIR ?? 'test-results/verify/manual'
const REPORT_PATH = process.env.PLAYWRIGHT_JSON_REPORT_PATH ?? `${ARTIFACTS_DIR}/playwright-report.json`
const STORAGE_STATE_PATH = process.env.PLAYWRIGHT_STORAGE_STATE_PATH ?? `${ARTIFACTS_DIR}/auth-storage-state.json`

function verificationBrowser(): { executablePath: string | undefined; videoMode: 'off' | 'retain-on-failure' } {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim() || undefined
  if (executablePath) {
    let regularFile = false
    try { regularFile = isAbsolute(executablePath) && statSync(executablePath).isFile() } catch { /* invalid selection */ }
    if (!regularFile) throw new Error('PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH must name an existing absolute file')
  }
  const videoMode = process.env.PLAYWRIGHT_VIDEO_MODE || 'retain-on-failure'
  if (videoMode !== 'off' && videoMode !== 'retain-on-failure') {
    throw new Error('PLAYWRIGHT_VIDEO_MODE must be off or retain-on-failure')
  }
  return { executablePath, videoMode }
}

function browserLaunchOptions(mode: VerifyMode, executablePath?: string) {
  if (mode === 'ui') return { args: ['--disable-gpu'], ...(executablePath ? { executablePath } : {}) }
  return executablePath ? { executablePath } : undefined
}

export function createVerifyConfig({
  mode,
  testMatch,
  webServerCommand,
}: VerifyConfigOptions): PlaywrightTestConfig {
  const serverSettings = createPlaywrightServerSettings({ mode, env: process.env, platform: process.platform })
  if (!serverSettings.baseURL) {
    throw new Error(`PLAYWRIGHT_BASE_URL is required for ${mode} verification`)
  }
  const baseURL = serverSettings.baseURL
  const { executablePath, videoMode } = verificationBrowser()
  const launchOptions = browserLaunchOptions(mode, executablePath)

  return defineConfig({
    testDir: './test/ui',
    testMatch,
    timeout: 120_000,
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    workers: 1,
    outputDir: `${ARTIFACTS_DIR}/playwright-output`,
    reporter: [
      ['list'],
      ['json', { outputFile: REPORT_PATH }],
    ],
    globalSetup: './test/ui/global-verify-setup.ts',
    use: {
      baseURL,
      storageState: STORAGE_STATE_PATH,
      trace: 'retain-on-failure',
      video: videoMode,
      screenshot: 'only-on-failure',
    },
    projects: [
      {
        name: 'chromium',
        use: {
          ...devices['Desktop Chrome'],
          ...(launchOptions ? { launchOptions } : {}),
        },
      },
    ],
    metadata: {
      verificationMode: mode,
      artifactsDir: ARTIFACTS_DIR,
    },
    ...(webServerCommand ? {
      webServer: {
        command: webServerCommand,
        cwd: process.cwd(),
        env: serverSettings.env,
        url: `${baseURL}/app`,
        reuseExistingServer: false,
        timeout: 240_000,
      },
    } : {}),
  })
}

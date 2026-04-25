import { defineConfig, devices } from '@playwright/test'

const PORT = process.env.PLAYWRIGHT_PORT ?? '4302'
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`
const ARTIFACTS_DIR = process.env.PLAYWRIGHT_ARTIFACTS_DIR ?? 'test-results/verify/manual-direct'
const STORAGE_STATE_PATH = process.env.PLAYWRIGHT_STORAGE_STATE_PATH ?? `${ARTIFACTS_DIR}/auth-storage-state.json`
const REPORT_PATH = process.env.PLAYWRIGHT_JSON_REPORT_PATH ?? `${ARTIFACTS_DIR}/playwright-report.json`

export default defineConfig({
  testDir: './test/ui',
  testMatch: '**/workbench-envelope.verify.e2e.ts',
  timeout: 120_000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  outputDir: `${ARTIFACTS_DIR}/playwright-output`,
  reporter: [
    ['list'],
    ['json', { outputFile: REPORT_PATH }],
  ],
  globalSetup: './test/ui/global-verify-setup.ts',
  use: {
    baseURL: BASE_URL,
    storageState: STORAGE_STATE_PATH,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})

import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test'

type VerifyMode = 'local' | 'ci' | 'release-live'

interface VerifyConfigOptions {
  mode: VerifyMode
  testMatch: string | string[]
  webServerCommand?: string
}

const PORT = process.env.PLAYWRIGHT_PORT ?? '4301'
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PORT}`
const ARTIFACTS_DIR = process.env.PLAYWRIGHT_ARTIFACTS_DIR ?? 'test-results/verify/manual'
const REPORT_PATH = process.env.PLAYWRIGHT_JSON_REPORT_PATH ?? `${ARTIFACTS_DIR}/playwright-report.json`

export function createVerifyConfig({
  mode,
  testMatch,
  webServerCommand,
}: VerifyConfigOptions): PlaywrightTestConfig {
  return defineConfig({
    testDir: './test/ui',
    testMatch,
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
      baseURL: BASE_URL,
      trace: 'retain-on-failure',
      video: 'retain-on-failure',
      screenshot: 'only-on-failure',
    },
    projects: [
      {
        name: 'chromium',
        use: { ...devices['Desktop Chrome'] },
      },
    ],
    metadata: {
      verificationMode: mode,
      artifactsDir: ARTIFACTS_DIR,
    },
    ...(webServerCommand ? {
      webServer: {
        command: webServerCommand,
        cwd: __dirname,
        env: {
          ...process.env,
          PATH: [`${process.env.HOME}/.bun/bin`, process.env.PATH]
            .filter(Boolean)
            .join(':'),
          SystemRoot: process.env.SystemRoot ?? 'C:\\Windows',
        },
        url: `${BASE_URL}/app`,
        reuseExistingServer: false,
        timeout: 240_000,
      },
    } : {}),
  })
}

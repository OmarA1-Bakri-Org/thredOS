import { createVerifyConfig } from './playwright.verify.shared'

export default createVerifyConfig({
  mode: 'ci',
  testMatch: ['**/*.verify.e2e.ts', '**/main-page.e2e.ts'],
  webServerCommand: `"${process.execPath}" scripts/verify/web-server.mjs ci`,
})

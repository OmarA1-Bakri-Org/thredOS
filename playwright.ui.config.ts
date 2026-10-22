import { createVerifyConfig } from './playwright.verify.shared'

export default createVerifyConfig({
  mode: 'ui',
  testMatch: ['**/main-page.e2e.ts', '**/workspace-inspector.e2e.ts'],
  webServerCommand: `"${process.execPath}" scripts/verify/web-server.mjs ci`,
})

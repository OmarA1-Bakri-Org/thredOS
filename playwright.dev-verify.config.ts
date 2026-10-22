import { createVerifyConfig } from './playwright.verify.shared'

export default createVerifyConfig({
  mode: 'local',
  testMatch: ['**/*.verify.e2e.ts', '**/workspace-inspector.e2e.ts', '**/change-set-review.e2e.ts'],
  webServerCommand: `"${process.execPath}" scripts/verify/web-server.mjs local`,
})

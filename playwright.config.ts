import { createVerifyConfig } from './playwright.verify.shared'

export default createVerifyConfig({
  mode: 'ci',
  testMatch: '**/*.verify.e2e.ts',
  webServerCommand: 'node scripts/verify/web-server.mjs ci',
})

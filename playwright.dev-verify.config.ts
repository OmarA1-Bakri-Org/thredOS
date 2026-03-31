import { createVerifyConfig } from './playwright.verify.shared'

export default createVerifyConfig({
  mode: 'local',
  testMatch: '**/*.verify.e2e.ts',
  webServerCommand: 'node scripts/verify/web-server.mjs local',
})

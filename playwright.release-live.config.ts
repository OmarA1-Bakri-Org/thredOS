import { createVerifyConfig } from './playwright.verify.shared'

export default createVerifyConfig({
  mode: 'release-live',
  testMatch: '**/*.live.e2e.ts',
})

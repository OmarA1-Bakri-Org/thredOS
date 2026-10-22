import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import { createVerifyConfig } from '../../playwright.verify.shared'

const keys = ['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH', 'PLAYWRIGHT_VIDEO_MODE'] as const
let previous: Record<string, string | undefined>

beforeEach(() => {
  previous = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  for (const key of keys) delete process.env[key]
})
afterEach(() => {
  for (const key of keys) {
    if (previous[key] === undefined) delete process.env[key]
    else process.env[key] = previous[key]
  }
})

describe('verification browser selection', () => {
  test('preserves default browser selection, failure video, traces and screenshots', () => {
    const config = createVerifyConfig({ mode: 'local', testMatch: '*.e2e.ts' })
    expect(config.projects?.[0]?.use?.launchOptions).toBeUndefined()
    expect(config.use).toMatchObject({ video: 'retain-on-failure', trace: 'retain-on-failure', screenshot: 'only-on-failure' })
  })

  test('keeps the UI launch arguments with an explicitly configured executable', () => {
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = process.execPath
    process.env.PLAYWRIGHT_VIDEO_MODE = 'off'
    const config = createVerifyConfig({ mode: 'ui', testMatch: '*.e2e.ts' })
    expect(config.projects?.[0]?.use?.launchOptions).toEqual({ executablePath: process.execPath, args: ['--disable-gpu'] })
    expect(config.use).toMatchObject({ video: 'off', trace: 'retain-on-failure', screenshot: 'only-on-failure' })
  })

  test('selects the configured executable without adding arguments in local mode', () => {
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = process.execPath
    const config = createVerifyConfig({ mode: 'local', testMatch: '*.e2e.ts' })
    expect(config.projects?.[0]?.use?.launchOptions).toEqual({ executablePath: process.execPath })
  })

  test.each(['relative-browser', dirname(process.execPath), join(dirname(process.execPath), `missing-browser-${randomUUID()}`)])(
    'rejects an unusable executable selection before setup: %s', path => {
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = path
      expect(() => createVerifyConfig({ mode: 'ui', testMatch: '*.e2e.ts' })).toThrow('existing absolute file')
    },
  )

  test('rejects an unknown video setting', () => {
    process.env.PLAYWRIGHT_VIDEO_MODE = 'unknown'
    expect(() => createVerifyConfig({ mode: 'local', testMatch: '*.e2e.ts' })).toThrow('PLAYWRIGHT_VIDEO_MODE')
  })
})

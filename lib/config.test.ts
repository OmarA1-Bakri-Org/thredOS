import { describe, test, expect, afterEach } from 'bun:test'
import { getBasePath } from './config'

describe('getBasePath', () => {
  const originalEnv = process.env.THREADOS_BASE_PATH

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.THREADOS_BASE_PATH = originalEnv
    } else {
      delete process.env.THREADOS_BASE_PATH
    }
  })

  test('returns THREADOS_BASE_PATH when set', () => {
    process.env.THREADOS_BASE_PATH = '/custom/path'
    expect(getBasePath()).toBe('/custom/path')
  })

  test('returns process.cwd() when env var not set', () => {
    delete process.env.THREADOS_BASE_PATH
    expect(getBasePath()).toBe(process.cwd())
  })

  test('returns empty string env var if set to empty', () => {
    process.env.THREADOS_BASE_PATH = ''
    // Empty string is falsy, so it falls back to cwd
    expect(getBasePath()).toBe(process.cwd())
  })
})

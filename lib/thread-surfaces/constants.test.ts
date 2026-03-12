import { describe, test, expect } from 'bun:test'
import { ROOT_THREAD_SURFACE_ID, deriveStepThreadSurfaceId } from './constants'

describe('ROOT_THREAD_SURFACE_ID', () => {
  test('is thread-root', () => {
    expect(ROOT_THREAD_SURFACE_ID).toBe('thread-root')
  })
})

describe('deriveStepThreadSurfaceId', () => {
  test('prefixes step id with thread-', () => {
    expect(deriveStepThreadSurfaceId('research')).toBe('thread-research')
  })

  test('handles hyphenated step ids', () => {
    expect(deriveStepThreadSurfaceId('draft-linkedin')).toBe('thread-draft-linkedin')
  })

  test('handles single character step ids', () => {
    expect(deriveStepThreadSurfaceId('a')).toBe('thread-a')
  })
})

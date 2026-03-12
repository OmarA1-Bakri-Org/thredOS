import { describe, test, expect } from 'bun:test'
import { ZodError, z } from 'zod'
import { jsonError, handleError } from './api-helpers'

describe('jsonError', () => {
  test('returns NextResponse with error and code', async () => {
    const res = jsonError('Not found', 'NOT_FOUND', 404)
    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data.error).toBe('Not found')
    expect(data.code).toBe('NOT_FOUND')
  })

  test('returns 400 for validation errors', async () => {
    const res = jsonError('Invalid input', 'VALIDATION_ERROR', 400)
    expect(res.status).toBe(400)
  })

  test('returns 500 for internal errors', async () => {
    const res = jsonError('Server error', 'INTERNAL_ERROR', 500)
    expect(res.status).toBe(500)
  })
})

describe('handleError', () => {
  test('handles ZodError with 400 status', async () => {
    const schema = z.object({ name: z.string() })
    let zodError: ZodError | null = null
    try {
      schema.parse({ name: 123 })
    } catch (e) {
      zodError = e as ZodError
    }
    const res = handleError(zodError!)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.code).toBe('VALIDATION_ERROR')
  })

  test('handles not found errors with 404 status', async () => {
    const res = handleError(new Error('Step step-x not found'))
    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data.code).toBe('NOT_FOUND')
  })

  test('handles ENOENT errors with 404 status', async () => {
    const res = handleError(new Error('ENOENT: no such file'))
    expect(res.status).toBe(404)
  })

  test('handles generic errors with 500 status', async () => {
    const res = handleError(new Error('something broke'))
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.code).toBe('INTERNAL_ERROR')
  })

  test('handles non-Error values', async () => {
    const res = handleError('string error')
    expect(res.status).toBe(500)
  })
})

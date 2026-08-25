import { describe, expect, test } from 'bun:test'
import {
  RUNTIME_LIFECYCLE_HANDLERS,
  scanRuntimeServiceBoundary,
} from '../../scripts/verify/m0-proof-helpers'

describe('runtime service architecture boundary', () => {
  test(`all ${RUNTIME_LIFECYCLE_HANDLERS.length} lifecycle handlers delegate ownership`, async () => {
    const report = await scanRuntimeServiceBoundary(process.cwd())
    expect(report.handlersScanned).toEqual([...RUNTIME_LIFECYCLE_HANDLERS])
    expect(report.violations).toEqual([])
    expect(report.passed).toBe(true)
  })
})

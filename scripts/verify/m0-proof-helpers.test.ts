import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  REQUIRED_M0_PROOF_FILES,
  normalizeProofValue,
  validateM0ProofBundle,
  withoutThreadOSBasePath,
} from './m0-proof-helpers'

describe('M0 proof normalization', () => {
  test('preserves meaningful content hashes while removing interface-only differences', () => {
    expect(normalizeProofValue({
      created_via: 'cli',
      request_hash: 'interface-request',
      sequence_snapshot_hash: 'sequence-content',
      compiled_prompt_hash: 'prompt-content',
    }, 'C:\\fixture')).toEqual({
      created_via: '<interface>',
      request_hash: '<interface-request-hash>',
      sequence_snapshot_hash: 'sequence-content',
      compiled_prompt_hash: 'prompt-content',
    })
  })
})

describe('M0 proof subprocess environment', () => {
  test('removes both supported runtime base-path aliases', () => {
    const sanitized = withoutThreadOSBasePath({
      THREDOS_BASE_PATH: 'C:\\fixture-a',
      THREADOS_BASE_PATH: 'C:\\fixture-b',
      PATH: 'C:\\tools',
    })
    expect(sanitized.PATH).toBe('C:\\tools')
    expect('THREDOS_BASE_PATH' in sanitized).toBe(false)
    expect('THREADOS_BASE_PATH' in sanitized).toBe(false)
  })
})

describe('M0 proof bundle validation', () => {
  test('accepts the complete canonical evidence layout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threados-m0-proof-shape-'))
    try {
      await mkdir(root, { recursive: true })
      await Promise.all(REQUIRED_M0_PROOF_FILES.map(fileName =>
        writeFile(join(root, fileName), `${fileName}\n`, 'utf8'),
      ))

      await expect(validateM0ProofBundle(root)).resolves.toEqual({
        valid: true,
        missing: [],
        empty: [],
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('reports missing and empty evidence explicitly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threados-m0-proof-invalid-'))
    try {
      await writeFile(join(root, REQUIRED_M0_PROOF_FILES[0]), '', 'utf8')

      const result = await validateM0ProofBundle(root)
      expect(result.valid).toBe(false)
      expect(result.empty).toEqual([REQUIRED_M0_PROOF_FILES[0]])
      expect(result.missing).toEqual(REQUIRED_M0_PROOF_FILES.slice(1))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

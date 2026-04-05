import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { readSequence, writeSequence } from './parser'
import { createTempDir, cleanTempDir, makeSequence, makeStep, writeTestSequence } from '../../test/helpers/setup'
import { SequenceValidationError } from '../errors'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'

let tempDir: string

beforeEach(async () => {
  tempDir = await createTempDir()
})

afterEach(async () => {
  await cleanTempDir(tempDir)
})

describe('readSequence / writeSequence', () => {
  test('roundtrip: write then read', async () => {
    const seq = makeSequence({
      steps: [makeStep({ id: 'a' }), makeStep({ id: 'b', depends_on: ['a'] })],
    })
    await writeTestSequence(tempDir, seq)
    // Now use writeSequence to overwrite, then readSequence
    await writeSequence(tempDir, seq)
    const result = await readSequence(tempDir)
    expect(result.name).toBe('test-sequence')
    expect(result.steps).toHaveLength(2)
    expect(result.steps[1].depends_on).toEqual(['a'])
  })

  test('throws on malformed YAML', async () => {
    const dir = join(tempDir, '.threados')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'sequence.yaml'), '{{invalid yaml', 'utf-8')
    await expect(readSequence(tempDir)).rejects.toThrow()
  })

  test('returns default sequence when file missing', async () => {
    const result = await readSequence(tempDir)
    expect(result.name).toBe('New Sequence')
    expect(result.steps).toEqual([])
    expect(result.gates).toEqual([])
  })

  test('handles empty sequence', async () => {
    const seq = makeSequence({ steps: [], gates: [] })
    await writeTestSequence(tempDir, seq)
    const result = await readSequence(tempDir)
    expect(result.steps).toEqual([])
    expect(result.gates).toEqual([])
  })

test('throws SequenceValidationError on invalid data', async () => {
  const dir = join(tempDir, '.threados')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'sequence.yaml'), 'version: "1.0"\nsteps: []\ngates: []', 'utf-8')
  // Missing name
  await expect(readSequence(tempDir)).rejects.toThrow(SequenceValidationError)
})

test('preserves invalid sequence file contents after failed validation', async () => {
  const dir = join(tempDir, '.threados')
  await mkdir(dir, { recursive: true })
  const invalidContent = 'version: "1.0"\nsteps: []\ngates: []'
  const filePath = join(dir, 'sequence.yaml')
  await writeFile(filePath, invalidContent, 'utf-8')

  await expect(readSequence(tempDir)).rejects.toThrow(SequenceValidationError)
  await expect(readFile(filePath, 'utf-8')).resolves.toBe(invalidContent)
})

test('rejects stale writes when the sequence changed on disk', async () => {
  const original = makeSequence({ name: 'original' })
  await writeSequence(tempDir, original)

  const stale = await readSequence(tempDir)
  const fresh = await readSequence(tempDir)

  fresh.name = 'fresh-update'
  await writeSequence(tempDir, fresh)

  stale.name = 'stale-update'
  await expect(writeSequence(tempDir, stale)).rejects.toMatchObject({
    code: 'SEQUENCE_CONFLICT',
  })

  const result = await readSequence(tempDir)
  expect(result.name).toBe('fresh-update')
})
})

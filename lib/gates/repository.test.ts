import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, readFile, readdir, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { appendGateDecision, readGateDecisions, readGateDecisionsRecoveringTail } from './repository'
import type { GateDecision } from '@/lib/contracts/schemas'

const makeGateDecision = (overrides: Partial<GateDecision> = {}): GateDecision => ({
  id: 'decision-1',
  subject_type: 'step',
  subject_ref: 'step-abc',
  gate_type: 'policy_pass',
  status: 'PASS',
  reason_codes: [],
  evidence_refs: [],
  decided_by: 'threados',
  decided_at: '2026-03-29T00:00:00.000Z',
  ...overrides,
})

describe('gate decision repository', () => {
  let basePath: string

  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-gate-decisions-'))
  })

  afterEach(async () => {
    await rm(basePath, { recursive: true, force: true })
  })

  test('append and read a gate decision — verify fields', async () => {
    const decision = makeGateDecision()
    await appendGateDecision(basePath, 'run-1', decision)
    const results = await readGateDecisions(basePath, 'run-1')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('decision-1')
    expect(results[0].subject_type).toBe('step')
    expect(results[0].subject_ref).toBe('step-abc')
    expect(results[0].gate_type).toBe('policy_pass')
    expect(results[0].status).toBe('PASS')
    expect(results[0].decided_by).toBe('threados')
    expect(results[0].decided_at).toBe('2026-03-29T00:00:00.000Z')
  })

  test('returns empty array for missing file', async () => {
    const results = await readGateDecisions(basePath, 'nonexistent-run')
    expect(results).toEqual([])
  })

  test('append multiple decisions, read back, verify count', async () => {
    await appendGateDecision(basePath, 'run-2', makeGateDecision({ id: 'decision-1', status: 'PASS' }))
    await appendGateDecision(basePath, 'run-2', makeGateDecision({ id: 'decision-2', status: 'BLOCK' }))
    await appendGateDecision(basePath, 'run-2', makeGateDecision({ id: 'decision-3', status: 'NEEDS_APPROVAL' }))
    const results = await readGateDecisions(basePath, 'run-2')
    expect(results).toHaveLength(3)
    expect(results[0].id).toBe('decision-1')
    expect(results[1].id).toBe('decision-2')
    expect(results[2].id).toBe('decision-3')
  })

  test('archives a torn final line before recovery and retains every earlier decision', async () => {
    await appendGateDecision(basePath, 'run-torn', makeGateDecision({ id: 'decision-1' }))
    await appendGateDecision(basePath, 'run-torn', makeGateDecision({ id: 'decision-2' }))
    const dir = join(basePath, '.threados', 'runs', 'run-torn')
    const journal = join(dir, 'gate-decisions.ndjson')
    const original = `${await readFile(journal, 'utf8')}{"id":"partial"`
    await writeFile(journal, original)
    await expect(readGateDecisions(basePath, 'run-torn')).rejects.toThrow('GATE_DECISION_JOURNAL_CORRUPT')
    expect((await readGateDecisionsRecoveringTail(basePath, 'run-torn')).map(item => item.id))
      .toEqual(['decision-1', 'decision-2'])
    const archives = (await readdir(dir)).filter(name => name.startsWith('gate-decisions.ndjson.torn-'))
    expect(archives).toHaveLength(1)
    const archived = JSON.parse(await readFile(join(dir, archives[0]!), 'utf8'))
    expect(Buffer.from(archived.source_bytes_base64, 'base64')).toEqual(Buffer.from(original))
    await appendGateDecision(basePath, 'run-torn', makeGateDecision({ id: 'decision-3' }))
    expect((await readGateDecisions(basePath, 'run-torn')).map(item => item.id))
      .toEqual(['decision-1', 'decision-2', 'decision-3'])
  })

  test('does not rewrite a corrupt complete line or discard later decisions', async () => {
    await appendGateDecision(basePath, 'run-corrupt', makeGateDecision({ id: 'decision-1' }))
    const dir = join(basePath, '.threados', 'runs', 'run-corrupt')
    const journal = join(dir, 'gate-decisions.ndjson')
    const original = `${await readFile(journal, 'utf8')}{broken}\n${JSON.stringify(makeGateDecision({ id: 'decision-2' }))}\n`
    await writeFile(journal, original)
    await expect(readGateDecisionsRecoveringTail(basePath, 'run-corrupt'))
      .rejects.toThrow('GATE_DECISION_JOURNAL_CORRUPT')
    await expect(appendGateDecision(basePath, 'run-corrupt', makeGateDecision({ id: 'decision-3' })))
      .rejects.toThrow('GATE_DECISION_JOURNAL_CORRUPT')
    expect(await readFile(journal, 'utf8')).toBe(original)
    expect((await readdir(dir)).filter(name => name.includes('.torn-'))).toHaveLength(0)
  })

  test('next append repairs a torn tail and preserves a valid unterminated record', async () => {
    await appendGateDecision(basePath, 'run-next', makeGateDecision({ id: 'decision-1' }))
    const dir = join(basePath, '.threados', 'runs', 'run-next')
    const journal = join(dir, 'gate-decisions.ndjson')
    await writeFile(journal, (await readFile(journal, 'utf8')).trimEnd())
    await appendGateDecision(basePath, 'run-next', makeGateDecision({ id: 'decision-2' }))
    expect((await readGateDecisions(basePath, 'run-next')).map(item => item.id))
      .toEqual(['decision-1', 'decision-2'])
    await writeFile(journal, `${await readFile(journal, 'utf8')}{"id":"partial`)
    const damagedBytes = await readFile(journal, 'utf8')
    await appendGateDecision(basePath, 'run-next', makeGateDecision({ id: 'decision-3' }))
    expect((await readGateDecisions(basePath, 'run-next')).map(item => item.id))
      .toEqual(['decision-1', 'decision-2', 'decision-3'])
    const archives = (await readdir(dir)).filter(name => name.startsWith('gate-decisions.ndjson.torn-'))
    expect(archives).toHaveLength(1)
    const archived = JSON.parse(await readFile(join(dir, archives[0]!), 'utf8'))
    expect(Buffer.from(archived.source_bytes_base64, 'base64')).toEqual(Buffer.from(damagedBytes))
  })

  test('archives a truncated multibyte tail byte for byte', async () => {
    await appendGateDecision(basePath, 'run-utf8', makeGateDecision({ id: 'decision-1' }))
    const dir = join(basePath, '.threados', 'runs', 'run-utf8')
    const journal = join(dir, 'gate-decisions.ndjson')
    const validPrefix = await readFile(journal)
    const original = Buffer.concat([validPrefix, Buffer.from([0x7b, 0x22, 0xc3])])
    await writeFile(journal, original)
    expect((await readGateDecisionsRecoveringTail(basePath, 'run-utf8')).map(item => item.id))
      .toEqual(['decision-1'])
    expect(await readFile(journal)).toEqual(validPrefix)
    const archives = (await readdir(dir)).filter(name => name.startsWith('gate-decisions.ndjson.torn-'))
    expect(archives).toHaveLength(1)
    const archived = JSON.parse(await readFile(join(dir, archives[0]!), 'utf8'))
    expect(archived.source_sha256).toBe(`sha256:${archives[0]!.slice('gate-decisions.ndjson.torn-'.length, -'.json'.length)}`)
    expect(Buffer.from(archived.source_bytes_base64, 'base64')).toEqual(original)
  })

  test('serializes concurrent appends without losing a decision', async () => {
    await Promise.all(Array.from({ length: 8 }, (_, index) => appendGateDecision(basePath,
      'run-concurrent', makeGateDecision({ id: `decision-${index}` }))))
    const decisions = await readGateDecisions(basePath, 'run-concurrent')
    expect(decisions).toHaveLength(8)
    expect(new Set(decisions.map(item => item.id)).size).toBe(8)
  })
})

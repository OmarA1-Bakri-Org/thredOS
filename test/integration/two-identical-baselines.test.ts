import { afterEach, describe, expect, test } from 'bun:test'
import { createPr11Fixture, listFixtureWorkspaces, type Pr11Fixture } from './pr11-workspace-test-helper'

let fixture: Pr11Fixture | null = null
afterEach(async () => { await fixture?.cleanup(); fixture = null })

describe('PR-11 comparable baselines', () => {
  test('two sequential write attempts share one immutable snapshot and use distinct workspaces', async () => {
    fixture = await createPr11Fixture(['candidate-a', 'candidate-b'])
    const outcome = await fixture.run()
    const workspaces = await listFixtureWorkspaces(fixture.canonical)

    expect(outcome.attempts).toHaveLength(2)
    expect(new Set(outcome.attempts.map(item => item.baseline_snapshot_id))).toEqual(new Set([outcome.run.baseline_snapshot_id]))
    expect(new Set(outcome.attempts.map(item => item.workspace_id)).size).toBe(2)
    expect(new Set(workspaces.map(item => item.root_path)).size).toBe(2)
    expect(workspaces.every(item => item.snapshot_id === outcome.run.baseline_snapshot_id)).toBe(true)
  }, 30_000)
})

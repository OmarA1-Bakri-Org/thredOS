import { describe, expect, test } from 'bun:test'
import { ThreadInspector } from './ThreadInspector'
import type { ThreadSurfaceFocusedDetail } from '@/components/canvas/threadSurfaceFocus'
import type { SkillBadge } from '@/components/skills/SkillBadgeRow'

const detail: ThreadSurfaceFocusedDetail = {
  threadSurfaceId: 'surface-alpha',
  surfaceLabel: 'Alpha Thread',
  surfaceDescription: 'Primary synthesis agent',
  role: 'orchestrator',
  runId: 'run-001',
  runStatus: 'running',
  executionIndex: 3,
  runSummary: 'Processing step 4 of 7',
  runNotes: 'Needs human review at gate-2',
  runDiscussion: 'Team agreed to skip optional review',
  laneTerminalState: null,
  mergedIntoThreadSurfaceId: null,
  incomingMergeGroups: [
    {
      mergeEventId: 'merge-1',
      runId: 'run-001',
      mergeKind: 'single',
      executionIndex: 2,
      destinationThreadSurfaceId: 'surface-alpha',
      orderedThreadSurfaceIds: ['surface-alpha', 'surface-beta'],
    },
  ],
  outgoingMergeEvents: [],
}

const skills: SkillBadge[] = [
  { id: 'search', label: 'Search', inherited: false },
  { id: 'tools', label: 'Tools', inherited: false },
  { id: 'model', label: 'Model', inherited: true },
]

describe('ThreadInspector', () => {
  test('renders thread identity section with surface label and role', () => {
    const view = ThreadInspector({ detail, skills })
    const markup = JSON.stringify(view)
    expect(markup).toContain('Alpha Thread')
    expect(markup).toContain('orchestrator')
    expect(markup).toContain('running')
  })

  test('renders run context with summary, notes, and discussion', () => {
    const view = ThreadInspector({ detail, skills })
    const markup = JSON.stringify(view)
    expect(markup).toContain('Processing step 4 of 7')
    expect(markup).toContain('Needs human review at gate-2')
    expect(markup).toContain('Team agreed to skip optional review')
  })

  test('renders skill inventory with local and inherited skills', () => {
    const view = ThreadInspector({ detail, skills })
    const markup = JSON.stringify(view)
    expect(markup).toContain('Search')
    expect(markup).toContain('Tools')
    expect(markup).toContain('Model')
  })

  test('renders provenance with surface ID and run ID', () => {
    const view = ThreadInspector({ detail, skills })
    const markup = JSON.stringify(view)
    expect(markup).toContain('surface-alpha')
    expect(markup).toContain('run-001')
  })

  test('shows merge count in provenance', () => {
    const view = ThreadInspector({ detail, skills })
    const markup = JSON.stringify(view)
    expect(markup).toContain('1 in ·')
    expect(markup).toContain('0 out')
  })

  test('handles merged thread with terminal state', () => {
    const mergedDetail: ThreadSurfaceFocusedDetail = {
      ...detail,
      laneTerminalState: 'merged',
      mergedIntoThreadSurfaceId: 'surface-gamma',
    }
    const view = ThreadInspector({ detail: mergedDetail, skills })
    const markup = JSON.stringify(view)
    expect(markup).toContain('merged')
    expect(markup).toContain('surface-gamma')
  })

  test('renders empty skills state when no skills provided', () => {
    const view = ThreadInspector({ detail })
    const markup = JSON.stringify(view)
    // SkillInventoryPanel is a function component — JSON.stringify serializes
    // its props but not its rendered output. Verify empty skills array is passed.
    expect(markup).toContain('"skills":[]')
  })

  test('supports custom testIdPrefix', () => {
    const view = ThreadInspector({ detail, skills, testIdPrefix: 'custom' })
    const markup = JSON.stringify(view)
    expect(markup).toContain('custom-identity')
  })
})

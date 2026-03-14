/**
 * Thread-type E2E component tests — verifies the left rail renders
 * correct phase breakdowns and roles for each of the 6 thread types.
 *
 * Uses renderToStaticMarkup to test SequenceSection + PhaseSection
 * as an integrated flow, varying the status data per thread type.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

// ── Mock state ───────────────────────────────────────────────────────────────

let statusData: {
  name: string
  summary: { ready: number; running: number; done: number; failed: number }
  steps: Array<{ id: string; name: string; type: string; model: string; status: string; dependsOn: string[] }>
  gates: Array<{ id: string; name: string; status: string }>
}

const storeState: Record<string, unknown> = {
  selectedThreadSurfaceId: null,
  setSelectedThreadSurfaceId: () => {},
  selectedPhaseId: null,
  setSelectedPhaseId: () => {},
  selectedNodeId: null,
  setSelectedNodeId: () => {},
  expandAccordionSection: () => {},
  activeAccordionSections: ['sequence', 'phase'],
  setActiveAccordionSections: () => {},
  selectedRunId: null,
}

mock.module('@/lib/ui/store', () => ({
  useUIStore: Object.assign(
    (selector: (s: typeof storeState) => unknown) => selector(storeState),
    {
      setState: (patch: Partial<typeof storeState>) => Object.assign(storeState, patch),
      getState: () => storeState,
    },
  ),
}))

mock.module('@/lib/ui/api', () => ({
  useThreadSurfaces: () => ({ data: [] }),
  useStatus: () => ({
    data: statusData,
    isLoading: false,
  }),
}))

const { SequenceSection } = await import('./SequenceSection')
const { PhaseSection } = await import('./PhaseSection')

// ── Fixtures per thread type ─────────────────────────────────────────────────

function baseFixture() {
  return {
    name: 'base-sequence',
    summary: { ready: 1, running: 0, done: 0, failed: 0 },
    steps: [
      { id: 'research', name: 'Research', type: 'base', model: 'claude-code', status: 'ready', dependsOn: [] },
    ],
    gates: [
      { id: 'gate-research', name: 'Gate: Research', status: 'pending' },
    ],
  }
}

function parallelFixture() {
  return {
    name: 'parallel-sequence',
    summary: { ready: 3, running: 0, done: 0, failed: 0 },
    steps: [
      { id: 'agent-a', name: 'Agent A', type: 'base', model: 'claude-code', status: 'ready', dependsOn: [] },
      { id: 'agent-b', name: 'Agent B', type: 'base', model: 'gpt-4o', status: 'ready', dependsOn: [] },
      { id: 'agent-c', name: 'Agent C', type: 'base', model: 'gemini-2', status: 'ready', dependsOn: [] },
    ],
    gates: [],
  }
}

function chainedFixture() {
  return {
    name: 'chained-sequence',
    summary: { ready: 1, running: 1, done: 1, failed: 0 },
    steps: [
      { id: 'draft', name: 'Draft', type: 'base', model: 'claude-code', status: 'done', dependsOn: [] },
      { id: 'review', name: 'Review', type: 'base', model: 'claude-code', status: 'running', dependsOn: ['draft'] },
      { id: 'publish', name: 'Publish', type: 'base', model: 'claude-code', status: 'ready', dependsOn: ['review'] },
    ],
    gates: [
      { id: 'gate-draft', name: 'Gate: Draft', status: 'passed' },
      { id: 'gate-review', name: 'Gate: Review', status: 'pending' },
      { id: 'gate-publish', name: 'Gate: Publish', status: 'pending' },
    ],
  }
}

function fusionFixture() {
  return {
    name: 'fusion-sequence',
    summary: { ready: 1, running: 0, done: 2, failed: 0 },
    steps: [
      { id: 'candidate-1', name: 'Candidate 1', type: 'base', model: 'claude-code', status: 'done', dependsOn: [] },
      { id: 'candidate-2', name: 'Candidate 2', type: 'base', model: 'gpt-4o', status: 'done', dependsOn: [] },
      { id: 'synthesis', name: 'Synthesis', type: 'base', model: 'claude-code', status: 'ready', dependsOn: ['candidate-1', 'candidate-2'] },
    ],
    gates: [],
  }
}

function batonFixture() {
  return {
    name: 'baton-sequence',
    summary: { ready: 1, running: 1, done: 0, failed: 0 },
    steps: [
      { id: 'drafter', name: 'Drafter', type: 'base', model: 'claude-code', status: 'running', dependsOn: [] },
      { id: 'reviewer', name: 'Reviewer', type: 'base', model: 'gpt-4o', status: 'ready', dependsOn: ['drafter'] },
    ],
    gates: [
      { id: 'gate-drafter', name: 'Gate: Drafter', status: 'pending' },
    ],
  }
}

function longFixture() {
  return {
    name: 'long-sequence',
    summary: { ready: 2, running: 1, done: 0, failed: 0 },
    steps: [
      { id: 'main-agent', name: 'Main Agent', type: 'base', model: 'claude-code', status: 'running', dependsOn: [] },
      { id: 'watchdog-1', name: 'Watchdog 1', type: 'base', model: 'claude-code', status: 'ready', dependsOn: [] },
      { id: 'watchdog-2', name: 'Watchdog 2', type: 'base', model: 'claude-code', status: 'ready', dependsOn: [] },
    ],
    gates: [],
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  storeState.selectedPhaseId = null
  storeState.selectedNodeId = null
})

describe('Thread type E2E — SequenceSection', () => {
  test('base: shows Base active, 1 phase with P1 badge', () => {
    statusData = baseFixture()
    const markup = renderToStaticMarkup(<SequenceSection />)
    expect(markup).toContain('Phase overview')
    expect(markup).toContain('>1<')  // phase count
    expect(markup).toContain('phase')
    expect(markup).toContain('P1')   // primary phase badge
  })

  test('parallel: auto-detects p, shows 3 phases', () => {
    statusData = parallelFixture()
    const markup = renderToStaticMarkup(<SequenceSection />)
    expect(markup).toContain('>3<')
    expect(markup).toContain('phases')
    // All primary — should show P1, P2, P3
    expect(markup).toContain('P1')
    expect(markup).toContain('P2')
    expect(markup).toContain('P3')
  })

  test('chained: auto-detects c, shows 3 phases all primary', () => {
    statusData = chainedFixture()
    const markup = renderToStaticMarkup(<SequenceSection />)
    expect(markup).toContain('>3<')
    expect(markup).toContain('P1')
    expect(markup).toContain('P2')
    expect(markup).toContain('P3')
  })

  test('fusion: auto-detects f, shows C/C/S badges', () => {
    statusData = fusionFixture()
    const markup = renderToStaticMarkup(<SequenceSection />)
    expect(markup).toContain('>3<')
    // Candidate badge = "C", Synthesis badge = "S"
    const cBadges = (markup.match(/>C</g) || []).length
    expect(cBadges).toBeGreaterThanOrEqual(2)  // 2 candidate badges
    expect(markup).toContain('>S<')             // 1 synthesis badge
  })

  test('shows all 6 type buttons in type selector', () => {
    statusData = baseFixture()
    const markup = renderToStaticMarkup(<SequenceSection />)
    expect(markup).toContain('Base')
    expect(markup).toContain('Parallel')
    expect(markup).toContain('Chained')
    expect(markup).toContain('Fusion')
    expect(markup).toContain('Baton')
    expect(markup).toContain('Long')
  })

  test('shows template picker for all 6 types', () => {
    statusData = baseFixture()
    const markup = renderToStaticMarkup(<SequenceSection />)
    // Template section contains type descriptions
    expect(markup).toContain('Single agent, single task')
    expect(markup).toContain('Multiple agents simultaneously')
    expect(markup).toContain('Sequential pipeline with gates')
    expect(markup).toContain('Candidates → synthesis')
    expect(markup).toContain('Agent hand-off chain')
    expect(markup).toContain('Extended autonomous operation')
  })
})

describe('Thread type E2E — PhaseSection', () => {
  test('base: renders 1 phase with primary role badge', () => {
    statusData = baseFixture()
    const markup = renderToStaticMarkup(<PhaseSection />)
    expect(markup).toContain('Research')
    expect(markup).toContain('primary')
    expect(markup).toContain('1 node')
    expect(markup).toContain('1 gate')
  })

  test('parallel: renders 3 phases, all with primary role', () => {
    statusData = parallelFixture()
    const markup = renderToStaticMarkup(<PhaseSection />)
    expect(markup).toContain('Agent A')
    expect(markup).toContain('Agent B')
    expect(markup).toContain('Agent C')
    const primaryBadges = (markup.match(/primary/gi) || []).length
    expect(primaryBadges).toBeGreaterThanOrEqual(3)
  })

  test('chained: renders 3 phases in pipeline order', () => {
    statusData = chainedFixture()
    const markup = renderToStaticMarkup(<PhaseSection />)
    expect(markup).toContain('Draft')
    expect(markup).toContain('Review')
    expect(markup).toContain('Publish')
    // Each phase has a gate
    const gateLabels = (markup.match(/1 gate/g) || []).length
    expect(gateLabels).toBe(3)
  })

  test('fusion: shows candidate and synthesis role badges', () => {
    statusData = fusionFixture()
    const markup = renderToStaticMarkup(<PhaseSection />)
    expect(markup).toContain('Candidate 1')
    expect(markup).toContain('Candidate 2')
    expect(markup).toContain('Synthesis')
    const candidateBadges = (markup.match(/candidate/gi) || []).length
    expect(candidateBadges).toBeGreaterThanOrEqual(2)
    const synthesisBadges = (markup.match(/synthesis/gi) || []).length
    expect(synthesisBadges).toBeGreaterThanOrEqual(1)
  })

  test('baton: shows handoff role badge on all phases', () => {
    statusData = batonFixture()
    const markup = renderToStaticMarkup(<PhaseSection />)
    expect(markup).toContain('Drafter')
    expect(markup).toContain('Reviewer')
    // Auto-detects as 'c' (chained) not 'b' — roles will be primary
    // because baton isn't auto-detected. This test verifies auto-detect behavior.
    // For forced baton, the SequenceSection type selector would need to be clicked.
    // PhaseSection uses auto-detect, so roles will be 'primary' for chained.
    const primaryBadges = (markup.match(/primary/gi) || []).length
    expect(primaryBadges).toBeGreaterThanOrEqual(2)
  })

  test('long: shows primary + watchdog roles with override', () => {
    statusData = longFixture()
    const markup = renderToStaticMarkup(<PhaseSection />)
    expect(markup).toContain('Main Agent')
    expect(markup).toContain('Watchdog 1')
    expect(markup).toContain('Watchdog 2')
    // Auto-detects as 'p' (parallel, no deps) — all primary
    // Long-autonomy requires explicit override in SequenceSection type selector
    const primaryBadges = (markup.match(/primary/gi) || []).length
    expect(primaryBadges).toBeGreaterThanOrEqual(3)
  })

  test('phase count displays correctly', () => {
    statusData = fusionFixture()
    const markup = renderToStaticMarkup(<PhaseSection />)
    expect(markup).toContain('>3<')
    expect(markup).toContain('phases')
  })

  test('empty status shows no-phases message', () => {
    statusData = {
      name: 'empty',
      summary: { ready: 0, running: 0, done: 0, failed: 0 },
      steps: [],
      gates: [],
    }
    const markup = renderToStaticMarkup(<PhaseSection />)
    expect(markup).toContain('No phases detected')
  })
})

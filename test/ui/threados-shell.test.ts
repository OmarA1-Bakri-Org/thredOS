import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Unit-style E2E tests for the ThreadOS visual system tokens and shell components.
 *
 * These are NOT browser-based — they verify structural properties by reading
 * source files and checking imports/exports. Components that use 'use client'
 * or React hooks cannot be rendered in Bun, so we assert against file contents.
 */

const componentsDir = join(__dirname, '../../components')

describe('ThreadOS Shell — Token & Component Structure', () => {
  // ── Token CSS ──────────────────────────────────────────────────────────

  describe('threados-tokens.css', () => {
    const cssPath = join(componentsDir, 'ui/threados-tokens.css')
    const css = readFileSync(cssPath, 'utf-8')

    test('defines shell background tokens', () => {
      expect(css).toContain('--threados-bg-deepest')
      expect(css).toContain('--threados-bg-panel')
      expect(css).toContain('--threados-accent-blue')
    })

    test('defines typography scale tokens', () => {
      expect(css).toContain('--threados-label-size')
      expect(css).toContain('--threados-caption-tracking')
    })
  })

  // ── WorkbenchShell ─────────────────────────────────────────────────────

  test('WorkbenchShell renders expected data-workbench-region attributes', () => {
    const shellPath = join(componentsDir, 'workbench/WorkbenchShell.tsx')
    const source = readFileSync(shellPath, 'utf-8')

    // WorkbenchShell uses 'use client' and hooks (useUIStore), so we cannot
    // render it in Bun. Instead we verify the source contains the expected
    // region markers that the shell exposes to the DOM.
    expect(source).toContain('data-workbench-region="top-bar"')
    expect(source).toContain('data-workbench-region="accordion-panel"')
    expect(source).toContain('data-workbench-region="board"')
  })

  // ── AccordionPanel ─────────────────────────────────────────────────────

  test('AccordionPanel registers 6-section structure (sequence/phase/node/agent/gate/run)', () => {
    const accordionPath = join(componentsDir, 'workbench/AccordionPanel.tsx')
    const source = readFileSync(accordionPath, 'utf-8')

    expect(source).toContain("'sequence'")
    expect(source).toContain("'phase'")
    expect(source).toContain("'node'")
    expect(source).toContain("'agent'")
    expect(source).toContain("'gate'")
    expect(source).toContain("'run'")
  })

  // ── ThreadInspector ────────────────────────────────────────────────────

  test('ThreadInspector component can be imported and called', async () => {
    const mod = await import('../../components/inspector/ThreadInspector')
    expect(mod.ThreadInspector).toBeDefined()
    expect(typeof mod.ThreadInspector).toBe('function')

    const element = mod.ThreadInspector({
      detail: {
        threadSurfaceId: 'ts-1',
        surfaceLabel: 'Test Thread',
        role: 'orchestrator',
        runId: 'run-1',
        runStatus: 'running',
        executionIndex: 0,
        surfaceDescription: 'A test thread surface',
        runSummary: 'Running integration tests',
        runNotes: null,
        runDiscussion: null,
        laneTerminalState: null,
        mergedIntoThreadSurfaceId: null,
        incomingMergeGroups: [],
        outgoingMergeEvents: [],
      },
      testIdPrefix: 'thread-inspector',
    })

    // The returned JSX element should carry the expected test ID
    const json = JSON.stringify(element)
    expect(json).toContain('thread-inspector-inspector')
  })

  // ── LaneBoardView ─────────────────────────────────────────────────────

  test('LaneBoardView separates roster and surface regions', async () => {
    const mod = await import('../../components/lanes/LaneBoardView')
    expect(mod.LaneBoardView).toBeDefined()
    expect(typeof mod.LaneBoardView).toBe('function')

    const element = mod.LaneBoardView({
      rows: [
        {
          threadSurfaceId: 'ts-1',
          surfaceLabel: 'Lane Alpha',
          runId: 'run-1',
          executionIndex: 0,
        },
      ],
      focusedThreadSurfaceId: 'ts-1',
      selectedRunId: 'run-1',
      onFocusThread: () => {},
      onBackToHierarchy: () => {},
    })

    const json = JSON.stringify(element)
    expect(json).toContain('lane-board-roster')
    expect(json).toContain('lane-board-surface')
  })

  // ── Button variants ────────────────────────────────────────────────────

  test('Button component exports expected variants', async () => {
    const mod = await import('../../components/ui/button')
    expect(mod.buttonVariants).toBeDefined()
    expect(typeof mod.buttonVariants).toBe('function')
  })
})

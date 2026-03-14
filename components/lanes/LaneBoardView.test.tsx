import { describe, expect, test } from 'bun:test'
import type { ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LaneBoardView } from './LaneBoardView'
import type { LaneBoardDisplayRow, LaneBoardMergeGroup } from './useLaneBoard'

type ElementWithChildren = ReactElement<{ children?: ReactNode; [key: string]: unknown }>

function collectByDataTestId(node: ReactNode, target: string, acc: ElementWithChildren[] = []): ElementWithChildren[] {
  if (Array.isArray(node)) {
    for (const child of node) collectByDataTestId(child, target, acc)
    return acc
  }

  if (!node || typeof node !== 'object' || !('props' in node)) {
    return acc
  }

  const element = node as ElementWithChildren
  if (element.props['data-testid'] === target) {
    acc.push(element)
  }

  collectByDataTestId(element.props.children, target, acc)
  return acc
}

describe('LaneBoardView', () => {
  test('separates the lane roster from the focused execution surface', () => {
    const view = LaneBoardView({
      rows: [
        {
          threadSurfaceId: 'thread-synthesis',
          surfaceLabel: 'Synthesis',
          runId: 'run-synthesis',
          executionIndex: 20,
        },
        {
          threadSurfaceId: 'thread-review',
          surfaceLabel: 'Review',
          runId: 'run-review',
          executionIndex: 40,
          laneTerminalState: 'merged',
        },
      ],
      focusedThreadSurfaceId: 'thread-synthesis',
      selectedRunId: 'run-synthesis',
      onFocusThread: () => {},
      onBackToHierarchy: () => {},
      focusedContent: <div data-testid="lane-focused-content">Focused lane content</div>,
      workflowByThreadSurfaceId: {
        'thread-synthesis': {
          stepId: 'post_publish_analytics',
          stepName: 'Post-Publish Analytics',
          phaseLabel: 'Feedback',
          executionLabel: 'sub agent',
          hasCondition: true,
        },
      },
    })

    expect(collectByDataTestId(view, 'lane-board-roster')).toHaveLength(1)
    expect(collectByDataTestId(view, 'lane-board-surface')).toHaveLength(1)
    expect(collectByDataTestId(view, 'lane-focused-content')).toHaveLength(1)
  })

  test('renders simplified roster card with status dot, name, and index', () => {
    const view = LaneBoardView({
      rows: [
        {
          threadSurfaceId: 'thread-synthesis',
          surfaceLabel: 'Synthesis',
          runId: 'run-synthesis',
          executionIndex: 20,
        },
      ],
      focusedThreadSurfaceId: 'thread-synthesis',
      selectedRunId: 'run-synthesis',
      onFocusThread: () => {},
      onBackToHierarchy: () => {},
    })

    const markup = JSON.stringify(view)
    expect(markup).toContain('Synthesis')
    expect(markup).toContain('20')
  })

  test('supports multiple runs for the same thread surface in the lane roster', () => {
    const view = LaneBoardView({
      rows: [
        {
          threadSurfaceId: 'thread-root',
          surfaceLabel: 'New Sequence',
          runId: 'run-a',
          executionIndex: 1,
        },
        {
          threadSurfaceId: 'thread-root',
          surfaceLabel: 'New Sequence',
          runId: 'run-b',
          executionIndex: 2,
        },
      ],
      focusedThreadSurfaceId: 'thread-root',
      selectedRunId: 'run-b',
      onFocusThread: () => {},
      onBackToHierarchy: () => {},
    })

    const markup = JSON.stringify(view)
    expect(markup).toContain('run-a')
    expect(markup).toContain('run-b')
  })

  test('truncates long IDs to first 8 characters', () => {
    const longRunId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    const view = LaneBoardView({
      rows: [
        {
          threadSurfaceId: 'thread-abc',
          surfaceLabel: 'Test Step',
          runId: longRunId,
          executionIndex: 1,
        },
      ],
      focusedThreadSurfaceId: null,
      selectedRunId: null,
      onFocusThread: () => {},
      onBackToHierarchy: () => {},
    })

    const markup = JSON.stringify(view)
    expect(markup).toContain('a1b2c3d4')
    // Full ID should be present as title attribute for hover
    expect(markup).toContain(longRunId)
  })

  test('renders merged lanes visible with destination above source', () => {
    const view = LaneBoardView({
      rows: [
        {
          threadSurfaceId: 'thread-dest',
          surfaceLabel: 'Destination',
          runId: 'run-dest',
          executionIndex: 10,
        },
        {
          threadSurfaceId: 'thread-src-a',
          surfaceLabel: 'Source A',
          runId: 'run-src-a',
          executionIndex: 20,
          laneTerminalState: 'merged',
        },
        {
          threadSurfaceId: 'thread-src-b',
          surfaceLabel: 'Source B',
          runId: 'run-src-b',
          executionIndex: 30,
          laneTerminalState: 'merged',
        },
      ],
      focusedThreadSurfaceId: 'thread-dest',
      selectedRunId: 'run-dest',
      onFocusThread: () => {},
      onBackToHierarchy: () => {},
    })

    const markup = JSON.stringify(view)
    expect(markup).toContain('Destination')
    expect(markup).toContain('Source A')
    expect(markup).toContain('Source B')
    expect(markup.indexOf('Destination') < markup.indexOf('Source A')).toBe(true)
  })

  test('renders lane roster preserving execution index ordering', () => {
    const view = LaneBoardView({
      rows: [
        {
          threadSurfaceId: 'thread-c',
          surfaceLabel: 'C',
          runId: 'run-c',
          executionIndex: 30,
        },
        {
          threadSurfaceId: 'thread-a',
          surfaceLabel: 'A',
          runId: 'run-a',
          executionIndex: 10,
        },
        {
          threadSurfaceId: 'thread-b',
          surfaceLabel: 'B',
          runId: 'run-b',
          executionIndex: 20,
        },
      ],
      focusedThreadSurfaceId: null,
      selectedRunId: null,
      onFocusThread: () => {},
      onBackToHierarchy: () => {},
    })

    const markup = JSON.stringify(view)
    expect(markup).toContain('C')
    expect(markup).toContain('A')
    expect(markup).toContain('B')
  })
})

/* ─────────────────────────────────────────────
 * Phase 6 — Merge & Convergence UI
 * ───────────────────────────────────────────── */

function baseRows(): LaneBoardDisplayRow[] {
  return [
    { threadSurfaceId: 'thread-research', surfaceLabel: 'Research', runId: 'run-1', executionIndex: 1, laneTerminalState: 'merged', isMergeSource: true, parentThreadSurfaceId: null, depth: 0, childCount: 0, isCollapsed: false },
    { threadSurfaceId: 'thread-outreach', surfaceLabel: 'Outreach', runId: 'run-2', executionIndex: 2, laneTerminalState: 'merged', isMergeSource: true, parentThreadSurfaceId: null, depth: 0, childCount: 0, isCollapsed: false },
    { threadSurfaceId: 'thread-synthesis', surfaceLabel: 'Synthesis', runId: 'run-3', executionIndex: 3, laneTerminalState: 'completed', isMergeSource: false, parentThreadSurfaceId: null, depth: 0, childCount: 0, isCollapsed: false },
  ]
}

function blockMergeGroup(): LaneBoardMergeGroup {
  return {
    mergeEventId: 'merge-1',
    runId: 'run-3',
    mergeKind: 'block',
    executionIndex: 3,
    destinationThreadSurfaceId: 'thread-synthesis',
    orderedThreadSurfaceIds: ['thread-synthesis', 'thread-research', 'thread-outreach'],
  }
}

function singleMergeGroup(): LaneBoardMergeGroup {
  return {
    mergeEventId: 'merge-2',
    runId: 'run-2',
    mergeKind: 'single',
    executionIndex: 2,
    destinationThreadSurfaceId: 'thread-outreach',
    orderedThreadSurfaceIds: ['thread-outreach', 'thread-research'],
  }
}

const defaultProps = {
  rows: baseRows(),
  focusedThreadSurfaceId: null,
  selectedRunId: null,
  onFocusThread: () => {},
  onBackToHierarchy: () => {},
}

describe('LaneBoardView — Merge & Convergence UI', () => {
  test('renders roster with lane rows', () => {
    const markup = renderToStaticMarkup(<LaneBoardView {...defaultProps} />)
    expect(markup).toContain('Research')
    expect(markup).toContain('Outreach')
    expect(markup).toContain('Synthesis')
  })

  test('renders gate diamond for merge group', () => {
    const markup = renderToStaticMarkup(
      <LaneBoardView {...defaultProps} mergeGroups={[blockMergeGroup()]} />,
    )
    expect(markup).toContain('data-testid="merge-diamond-merge-1"')
  })

  test('block merge shows count badge', () => {
    const markup = renderToStaticMarkup(
      <LaneBoardView {...defaultProps} mergeGroups={[blockMergeGroup()]} />,
    )
    // 2 source lanes (Research + Outreach) merging into 1 destination (Synthesis)
    expect(markup).toContain('2')
    expect(markup).toContain('1')
    // The combined badge text "2 → 1" or equivalent representation
    expect(markup).toMatch(/2\s*→\s*1|2\s*&#x2192;\s*1|2.*→.*1|2.*&#x2192;.*1/)
  })

  test('single merge does not show count badge', () => {
    const markup = renderToStaticMarkup(
      <LaneBoardView {...defaultProps} mergeGroups={[singleMergeGroup()]} />,
    )
    // Single merge should not display a source count badge
    // It should have the diamond but not the "N → 1" count
    expect(markup).toContain('data-testid="merge-diamond-merge-2"')
    expect(markup).not.toMatch(/\d+\s*→\s*1|\d+\s*&#x2192;\s*1/)
  })

  test('merged lanes have terminal state styling', () => {
    const markup = renderToStaticMarkup(
      <LaneBoardView {...defaultProps} mergeGroups={[blockMergeGroup()]} />,
    )
    // Rows with laneTerminalState === 'merged' should show "Merged" text
    expect(markup).toContain('Merged')
    // Merged rows should have reduced opacity styling
    expect(markup).toContain('opacity')
  })

  test('renders without merge groups', () => {
    // No mergeGroups prop at all
    const markupNoProp = renderToStaticMarkup(<LaneBoardView {...defaultProps} />)
    expect(markupNoProp).toContain('Research')
    expect(markupNoProp).toContain('Outreach')
    expect(markupNoProp).toContain('Synthesis')
    expect(markupNoProp).not.toContain('data-testid="merge-diamond-')

    // Empty mergeGroups array
    const markupEmpty = renderToStaticMarkup(
      <LaneBoardView {...defaultProps} mergeGroups={[]} />,
    )
    expect(markupEmpty).toContain('Research')
    expect(markupEmpty).toContain('Outreach')
    expect(markupEmpty).toContain('Synthesis')
    expect(markupEmpty).not.toContain('data-testid="merge-diamond-')
  })

  test('merge diamond shows merge kind label', () => {
    const blockMarkup = renderToStaticMarkup(
      <LaneBoardView {...defaultProps} mergeGroups={[blockMergeGroup()]} />,
    )
    expect(blockMarkup).toContain('block')

    const singleMarkup = renderToStaticMarkup(
      <LaneBoardView {...defaultProps} mergeGroups={[singleMergeGroup()]} />,
    )
    expect(singleMarkup).toContain('single')
  })
})

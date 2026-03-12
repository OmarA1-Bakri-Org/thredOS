import { describe, expect, test } from 'bun:test'
import type { ReactElement, ReactNode } from 'react'
import { LaneBoardView } from './LaneBoardView'

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

  test('renders workflow phase and execution metadata as inline text', () => {
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

    const markup = JSON.stringify(view)
    expect(markup).toContain('Feedback')
    expect(markup).toContain('sub agent')
    expect(markup).toContain('conditional')
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
})

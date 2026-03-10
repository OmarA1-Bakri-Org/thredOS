import { describe, expect, test } from 'bun:test'
import type { ReactElement, ReactNode } from 'react'
import { FocusedThreadCard } from './FocusedThreadCard'
import type { HierarchyViewNode } from './HierarchyView'

type ElementWithChildren = ReactElement<{
  children?: ReactNode
  [key: string]: unknown
}>

function collectByTestId(node: ReactNode, target: string, acc: ElementWithChildren[] = []): ElementWithChildren[] {
  if (Array.isArray(node)) {
    for (const child of node) collectByTestId(child, target, acc)
    return acc
  }

  if (!node || typeof node !== 'object' || !('props' in node)) {
    return acc
  }

  const element = node as ElementWithChildren
  if (element.props['data-testid'] === target) {
    acc.push(element)
  }

  collectByTestId(element.props.children, target, acc)
  return acc
}

const node: HierarchyViewNode = {
  id: 'thread-master',
  surfaceLabel: 'Master Thread',
  depth: 0,
  childCount: 4,
  runStatus: 'running',
  runSummary: 'Synthesizing registered child work',
  role: 'orchestrator',
  surfaceDescription: 'Top-level structural owner',
  clickTarget: {
    threadSurfaceId: 'thread-master',
    runId: 'run-022',
  },
}

describe('FocusedThreadCard', () => {
  test('renders badges, builder, pack, skill inventory, scores, and rubric bars', () => {
    const card = FocusedThreadCard({
      node,
      profile: {
        builder: 'Omar Al-Bakri',
        pack: 'Hero Pack',
        division: 'Champion',
        classification: 'Prompting',
        placement: 'Finalist',
        verified: true,
        threadPower: 9.1,
        weight: 8,
        delta: '+0.9 from verified runs',
        rubric: [
          { label: 'Tools', value: 8 },
          { label: 'Model', value: 7 },
          { label: 'Autonomy', value: 6 },
          { label: 'Coordination', value: 9 },
          { label: 'Reliability', value: 8 },
          { label: 'Economy', value: 4 },
        ],
        skills: [
          { id: 'search', label: 'Search', inherited: false },
          { id: 'browser', label: 'Browser', inherited: false },
          { id: 'files', label: 'Files', inherited: true },
        ],
      },
      onOpenLane: () => {},
    })

    expect(collectByTestId(card, 'focused-thread-card')).toHaveLength(1)
    expect(collectByTestId(card, 'thread-badges')).toHaveLength(1)
    expect(collectByTestId(card, 'skill-inventory')).toHaveLength(1)
    expect(collectByTestId(card, 'rubric-block')).toHaveLength(1)
    expect(collectByTestId(card, 'score-thread-power')).toHaveLength(1)
    expect(collectByTestId(card, 'score-weight')).toHaveLength(1)
  })
})

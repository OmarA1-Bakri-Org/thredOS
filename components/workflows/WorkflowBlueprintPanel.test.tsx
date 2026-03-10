import { describe, expect, test } from 'bun:test'
import type { ReactElement, ReactNode } from 'react'
import { WorkflowBlueprintPanel } from './WorkflowBlueprintPanel'
import { contentCreatorWorkflow } from '@/lib/workflows/content-creator'

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

describe('WorkflowBlueprintPanel', () => {
  test('renders the workflow blueprint, connections, and post-completion signals', () => {
    const panel = WorkflowBlueprintPanel({
      workflow: contentCreatorWorkflow,
    })

    expect(collectByTestId(panel, 'workflow-blueprint-panel')).toHaveLength(1)
    expect(collectByTestId(panel, 'workflow-phase-column')).toHaveLength(7)
    expect(collectByTestId(panel, 'workflow-connections-panel')).toHaveLength(1)
    expect(collectByTestId(panel, 'workflow-post-completion-panel')).toHaveLength(1)
  })
})

import { describe, expect, test } from 'bun:test'
import type { ReactElement, ReactNode } from 'react'
import { WorkflowStepContextPanel } from './WorkflowStepContextPanel'
import { contentCreatorWorkflow, getWorkflowStepById } from '@/lib/workflows/content-creator'

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

describe('WorkflowStepContextPanel', () => {
  test('renders a detailed workflow step context for the selected step', () => {
    const panel = WorkflowStepContextPanel({
      workflow: contentCreatorWorkflow,
      step: getWorkflowStepById(contentCreatorWorkflow, 'research')!,
    })

    expect(collectByTestId(panel, 'workflow-step-context-panel')).toHaveLength(1)
    expect(collectByTestId(panel, 'workflow-step-metadata')).toHaveLength(1)
    expect(collectByTestId(panel, 'workflow-step-actions')).toHaveLength(1)
    expect(collectByTestId(panel, 'workflow-step-outputs')).toHaveLength(1)
  })
})

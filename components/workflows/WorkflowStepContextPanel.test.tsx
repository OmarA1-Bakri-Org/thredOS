import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkflowStepContextPanel } from './WorkflowStepContextPanel'
import { contentCreatorWorkflow, getWorkflowStepById } from '@/lib/workflows/content-creator'

function countOccurrences(source: string, needle: string) {
  return source.split(needle).length - 1
}

describe('WorkflowStepContextPanel', () => {
  test('renders a focused workflow step context without expanding into a dense metadata table', () => {
    const markup = renderToStaticMarkup(
      <WorkflowStepContextPanel
        workflow={contentCreatorWorkflow}
        step={getWorkflowStepById(contentCreatorWorkflow, 'research')!}
      />,
    )

    expect(countOccurrences(markup, 'data-testid="workflow-step-context-panel"')).toBe(1)
    expect(countOccurrences(markup, 'data-testid="workflow-step-summary"')).toBe(1)
    expect(countOccurrences(markup, 'data-testid="workflow-step-metadata"')).toBe(0)
    expect(countOccurrences(markup, 'data-testid="workflow-step-actions"')).toBe(1)
    expect(countOccurrences(markup, 'data-testid="workflow-step-outputs"')).toBe(1)
  })
})

import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkflowBlueprintPanel } from './WorkflowBlueprintPanel'
import { contentCreatorWorkflow } from '@/lib/workflows/content-creator'

function countOccurrences(source: string, needle: string) {
  return source.split(needle).length - 1
}

describe('WorkflowBlueprintPanel', () => {
  test('renders a compact workflow blueprint summary with phase chips and context summaries', () => {
    const markup = renderToStaticMarkup(<WorkflowBlueprintPanel workflow={contentCreatorWorkflow} />)

    expect(countOccurrences(markup, 'data-testid="workflow-blueprint-panel"')).toBe(1)
    expect(countOccurrences(markup, 'data-testid="workflow-phase-chip"')).toBe(7)
    expect(countOccurrences(markup, 'data-testid="workflow-summary-grid"')).toBe(1)
    expect(countOccurrences(markup, 'data-testid="workflow-connections-panel"')).toBe(1)
    expect(countOccurrences(markup, 'data-testid="workflow-post-completion-panel"')).toBe(1)
  })
})

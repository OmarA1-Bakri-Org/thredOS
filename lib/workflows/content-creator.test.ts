import { describe, expect, test } from 'bun:test'
import { contentCreatorWorkflow, getWorkflowStepById, resolveWorkflowReferenceStep } from './content-creator'

describe('contentCreatorWorkflow', () => {
  test('normalizes prerequisite connections, step shape, and post-completion signals', () => {
    expect(contentCreatorWorkflow.id).toBe('content_creator')
    expect(contentCreatorWorkflow.prerequisites.connections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'linkedin',
          required: true,
          type: 'rube',
          onUnavailable: 'skip_dependent_steps',
        }),
        expect.objectContaining({
          name: 'telegram',
          required: false,
          type: 'rube',
          onUnavailable: 'warn',
        }),
      ]),
    )

    expect(contentCreatorWorkflow.qualityGates).toHaveLength(5)
    expect(contentCreatorWorkflow.postCompletion.crossChannelSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'POST_PUBLISHED', toAgent: 'orchestrator' }),
        expect.objectContaining({ type: 'CONTENT_PUBLISHED', toAgent: 'linkedin_growth_engine' }),
      ]),
    )
  })

  test('derives workflow step metadata used by the thread plane', () => {
    const strategy = getWorkflowStepById(contentCreatorWorkflow, 'strategy')
    expect(strategy).toMatchObject({
      id: 'strategy',
      phase: 1,
      execution: 'sub_agent',
      dependsOn: ['setup_workspace', 'pre_session'],
      timeoutMs: 300000,
      gateCount: 0,
      actionTypes: ['skill'],
      outputKeys: ['strategy_output', 'brainstorm_output', 'psychology_angles'],
      condition: 'user_needs_strategy == true',
    })

    const publishLinkedIn = getWorkflowStepById(contentCreatorWorkflow, 'publish_linkedin')
    expect(publishLinkedIn).toMatchObject({
      phase: 5,
      execution: 'sequential',
      gateCount: 2,
      actionTypes: ['rube_tool'],
      formatValidationCount: 13,
    })
  })

  test('resolves workflow reference steps from selected node and thread context', () => {
    expect(
      resolveWorkflowReferenceStep(contentCreatorWorkflow, {
        selectedNodeId: 'research',
        threadSurfaceLabel: 'Research',
      })?.id,
    ).toBe('research')

    expect(
      resolveWorkflowReferenceStep(contentCreatorWorkflow, {
        threadSurfaceLabel: 'Review',
        runSummary: 'Awaiting approval and final sign off.',
      })?.id,
    ).toBe('approval')

    expect(
      resolveWorkflowReferenceStep(contentCreatorWorkflow, {
        threadSurfaceLabel: 'Synthesis',
        runSummary: 'Publishing telemetry and analytics follow-up.',
      })?.id,
    ).toBe('post_publish_analytics')
  })
})

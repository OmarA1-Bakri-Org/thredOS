import { describe, test, expect } from 'bun:test'
import type {
  WorkflowConnection,
  WorkflowPrerequisites,
  WorkflowQualityGate,
  WorkflowStep,
  WorkflowPhase,
  WorkflowDefinition,
  WorkflowLaneContext,
  WorkflowCrossChannelSignal,
  WorkflowPostCompletion,
} from './types'

describe('Workflow types', () => {
  test('WorkflowConnection satisfies interface', () => {
    const conn: WorkflowConnection = {
      name: 'LinkedIn API',
      type: 'api',
      required: true,
      healthCheck: 'https://api.linkedin.com/health',
      onUnavailable: 'skip',
    }
    expect(conn.name).toBe('LinkedIn API')
    expect(conn.required).toBe(true)
    expect(conn.healthCheck).toBe('https://api.linkedin.com/health')
  })

  test('WorkflowPrerequisites satisfies interface', () => {
    const prereqs: WorkflowPrerequisites = {
      connections: [],
      envVars: ['API_KEY'],
      keyIds: { linkedin: 'key-123' },
    }
    expect(prereqs.envVars).toContain('API_KEY')
    expect(prereqs.keyIds.linkedin).toBe('key-123')
  })

  test('WorkflowQualityGate satisfies interface', () => {
    const gate: WorkflowQualityGate = {
      id: 'qg-1',
      type: 'hard',
      appliesTo: 'draft_linkedin',
      order: 1,
    }
    expect(gate.type).toBe('hard')
    expect(gate.order).toBe(1)
  })

  test('WorkflowStep satisfies interface', () => {
    const step: WorkflowStep = {
      id: 'research',
      name: 'Research',
      phase: 2,
      execution: 'parallel',
      description: 'Research topic',
      condition: null,
      dependsOn: [],
      timeoutMs: 60000,
      actionTypes: ['read', 'write'],
      outputKeys: ['research_results'],
      gateCount: 1,
      formatValidationCount: 0,
    }
    expect(step.phase).toBe(2)
    expect(step.condition).toBeNull()
    expect(step.actionTypes).toContain('read')
  })

  test('WorkflowPhase satisfies interface', () => {
    const phase: WorkflowPhase = {
      phase: 0,
      label: 'Setup',
      steps: [],
    }
    expect(phase.phase).toBe(0)
    expect(phase.label).toBe('Setup')
  })

  test('WorkflowLaneContext satisfies interface', () => {
    const lane: WorkflowLaneContext = {
      stepId: 'draft_linkedin',
      stepName: 'Draft LinkedIn Post',
      phaseLabel: 'Draft',
      executionLabel: 'sequential',
      hasCondition: false,
    }
    expect(lane.stepId).toBe('draft_linkedin')
    expect(lane.hasCondition).toBe(false)
  })

  test('WorkflowCrossChannelSignal satisfies interface', () => {
    const signal: WorkflowCrossChannelSignal = {
      type: 'publish_complete',
      fromAgent: 'publisher',
      toAgent: 'monitor',
    }
    expect(signal.type).toBe('publish_complete')
  })

  test('WorkflowPostCompletion satisfies interface', () => {
    const post: WorkflowPostCompletion = {
      crossChannelSignals: [],
    }
    expect(post.crossChannelSignals).toHaveLength(0)
  })

  test('WorkflowDefinition satisfies interface', () => {
    const def: WorkflowDefinition = {
      id: 'content-creator',
      name: 'Content Creator',
      version: '1.0',
      description: 'Multi-channel content workflow',
      prerequisites: { connections: [], envVars: [], keyIds: {} },
      qualityGates: [],
      postCompletion: { crossChannelSignals: [] },
      steps: [],
      phases: [],
    }
    expect(def.id).toBe('content-creator')
    expect(def.version).toBe('1.0')
  })
})

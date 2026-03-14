import rawWorkflow from './data/content-creator.json'
import type { WorkflowDefinition, WorkflowLaneContext, WorkflowPhase, WorkflowStep } from './types'

type RawWorkflow = typeof rawWorkflow

const phaseLabels: Record<number, string> = {
  0: 'Setup',
  1: 'Strategy',
  2: 'Research',
  3: 'Draft',
  4: 'Polish',
  5: 'Publish',
  6: 'Feedback',
}

const formatValidationCountByStepId: Record<string, number> = {
  draft_linkedin: rawWorkflow.format_rules.linkedin_post.rules.length,
  publish_linkedin: rawWorkflow.format_rules.linkedin_post.rules.length,
  draft_twitter: rawWorkflow.format_rules.tweet.rules.length,
  publish_twitter: rawWorkflow.format_rules.tweet.rules.length,
  draft_blog: rawWorkflow.format_rules.blog_post.rules.length,
  publish_blog: rawWorkflow.format_rules.blog_post.rules.length,
  draft_newsletter: rawWorkflow.format_rules.newsletter.rules.length,
  publish_newsletter: rawWorkflow.format_rules.newsletter.rules.length,
}

const STEP_DEFAULTS: Pick<WorkflowStep, 'condition' | 'dependsOn'> = {
  condition: null,
  dependsOn: [],
}

function normalizeStep(step: RawWorkflow['steps'][number]): WorkflowStep {
  const gateCount = step.gates ? Object.values(step.gates).flat().length : 0
  const outputKeys = (step.actions ?? [])
    .flatMap(action => ('output_key' in action && typeof action.output_key === 'string' ? [action.output_key] : []))

  return {
    id: step.id,
    name: step.name,
    phase: step.phase,
    execution: step.execution,
    description: step.description,
    condition: step.condition ?? STEP_DEFAULTS.condition,
    dependsOn: step.depends_on ?? STEP_DEFAULTS.dependsOn,
    timeoutMs: step.timeout_ms,
    actionTypes: [...new Set((step.actions ?? []).map(action => action.type))],
    outputKeys: [...new Set(outputKeys)],
    gateCount,
    formatValidationCount: formatValidationCountByStepId[step.id] ?? 0,
  }
}

function buildPhases(steps: WorkflowStep[]): WorkflowPhase[] {
  const phaseMap = new Map<number, WorkflowStep[]>()
  for (const step of steps) {
    const current = phaseMap.get(step.phase) ?? []
    current.push(step)
    phaseMap.set(step.phase, current)
  }

  return [...phaseMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([phase, phaseSteps]) => ({
      phase,
      label: phaseLabels[phase] ?? `Phase ${phase}`,
      steps: phaseSteps,
    }))
}

const steps = rawWorkflow.steps.map(normalizeStep)

export const contentCreatorWorkflow: WorkflowDefinition = {
  id: rawWorkflow.id,
  name: rawWorkflow.name,
  version: rawWorkflow.version,
  description: rawWorkflow.description,
  prerequisites: {
    connections: rawWorkflow.prerequisites.connections.map(connection => ({
      name: connection.name,
      type: connection.type,
      required: connection.required,
      healthCheck: connection.health_check,
      onUnavailable: connection.on_unavailable,
    })),
    envVars: rawWorkflow.prerequisites.env_vars,
    keyIds: rawWorkflow.prerequisites.key_ids,
  },
  qualityGates: rawWorkflow.quality_gates.map(gate => ({
    id: gate.id,
    type: gate.type as 'hard' | 'soft',
    appliesTo: gate.applies_to,
    order: gate.order,
  })),
  postCompletion: {
    crossChannelSignals: rawWorkflow.post_completion.cross_channel_signals.map(signal => ({
      type: signal.type,
      fromAgent: signal.from_agent,
      toAgent: signal.to_agent,
    })),
  },
  steps,
  phases: buildPhases(steps),
}

export function getWorkflowStepById(workflow: WorkflowDefinition, stepId: string): WorkflowStep | undefined {
  return workflow.steps.find(step => step.id === stepId)
}

export function findWorkflowStepsByKeyword(workflow: WorkflowDefinition, keyword: string): WorkflowStep[] {
  const lowered = keyword.trim().toLowerCase()
  if (!lowered) return []

  return workflow.steps.filter(step => {
    const haystack = `${step.id} ${step.name} ${step.description}`.toLowerCase()
    return haystack.includes(lowered)
  })
}

export function resolveWorkflowReferenceStep(
  workflow: WorkflowDefinition,
  {
    selectedNodeId,
    threadSurfaceLabel,
    threadRole,
    runSummary,
  }: {
    selectedNodeId?: string | null
    threadSurfaceLabel?: string | null
    threadRole?: string | null
    runSummary?: string | null
  },
): WorkflowStep | undefined {
  if (selectedNodeId) {
    const directMatch = getWorkflowStepById(workflow, selectedNodeId)
    if (directMatch) return directMatch
  }

  const haystack = [threadSurfaceLabel, threadRole, runSummary]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  const keywordFallbacks: Array<[string, string]> = [
    ['approval', 'approval'],
    ['review', 'approval'],
    ['synthesis', 'post_publish_analytics'],
    ['analytics', 'post_publish_analytics'],
    ['publish', 'publish_linkedin'],
    ['research', 'research'],
    ['strategy', 'strategy'],
    ['draft', 'draft_linkedin'],
    ['outreach', 'draft_linkedin'],
    ['master', 'strategy'],
  ]

  for (const [keyword, stepId] of keywordFallbacks) {
    if (haystack.includes(keyword)) {
      return getWorkflowStepById(workflow, stepId)
    }
  }

  return workflow.steps[0]
}

export function buildWorkflowLaneContext(workflow: WorkflowDefinition, step: WorkflowStep): WorkflowLaneContext {
  return {
    stepId: step.id,
    stepName: step.name,
    phaseLabel: workflow.phases.find(phase => phase.phase === step.phase)?.label ?? `Phase ${step.phase}`,
    executionLabel: step.execution.replace('_', ' '),
    hasCondition: Boolean(step.condition),
  }
}

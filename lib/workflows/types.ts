export interface WorkflowConnection {
  name: string
  type: string
  required: boolean
  healthCheck?: string
  onUnavailable: string
}

export interface WorkflowPrerequisites {
  connections: WorkflowConnection[]
  envVars: string[]
  keyIds: Record<string, string>
}

export interface WorkflowQualityGate {
  id: string
  type: 'hard' | 'soft'
  appliesTo: string
  order: number
}

export interface WorkflowCrossChannelSignal {
  type: string
  fromAgent: string
  toAgent: string
}

export interface WorkflowPostCompletion {
  crossChannelSignals: WorkflowCrossChannelSignal[]
}

export interface WorkflowStep {
  id: string
  name: string
  phase: number
  execution: string
  description: string
  condition: string | null
  dependsOn: string[]
  timeoutMs: number
  actionTypes: string[]
  outputKeys: string[]
  gateCount: number
  formatValidationCount: number
}

export interface WorkflowPhase {
  phase: number
  label: string
  steps: WorkflowStep[]
}

export interface WorkflowDefinition {
  id: string
  name: string
  version: string
  description: string
  prerequisites: WorkflowPrerequisites
  qualityGates: WorkflowQualityGate[]
  postCompletion: WorkflowPostCompletion
  steps: WorkflowStep[]
  phases: WorkflowPhase[]
}

export interface WorkflowLaneContext {
  stepId: string
  stepName: string
  phaseLabel: string
  executionLabel: string
  hasCondition: boolean
}

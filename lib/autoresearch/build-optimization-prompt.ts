import type { Sequence } from '@/lib/sequence/schema'
import YAML from 'yaml'

export function buildOptimizationPrompt(sequence: Sequence): string {
  const stateYaml = YAML.stringify({
    name: sequence.name,
    version: sequence.version,
    steps: sequence.steps.map(s => ({
      id: s.id,
      name: s.name,
      type: s.type,
      status: s.status,
      depends_on: s.depends_on,
      model: s.model,
      assigned_agent_id: s.assigned_agent_id,
    })),
    gates: sequence.gates.map(g => ({
      id: g.id,
      name: g.name,
      status: g.status,
      depends_on: g.depends_on,
    })),
    policy: sequence.policy,
  })

  return `You are the thredOS Workflow Optimizer. Analyze the current sequence and propose structural improvements.

## Current Sequence

\`\`\`yaml
${stateYaml}\`\`\`

## Optimization Categories

Analyze the sequence for these optimization opportunities:

- **parallelize** — Steps with no mutual dependency that run sequentially. Convert to parallel (type: 'p') or remove unnecessary deps.
- **add-gate** — Quality checkpoints missing between critical stages.
- **remove-dep** — Redundant or transitive dependencies that slow execution.
- **reorder** — Steps ordered suboptimally. Reorder to minimize critical path length.
- **reassign-agent** — Steps assigned to an agent whose skills don't match the task.

## Rules

1. Only propose changes that improve the sequence.
2. Each suggestion must include concrete actions using thredOS commands (step add, step update, dep add, dep remove, group create, etc.).
3. Rate your confidence (0-1) and expected impact (low/medium/high).
4. Provide a clear explanation of WHY each change improves the sequence.
5. Use the propose_optimizations tool to return your analysis.

## Available Commands

step add, step remove, step update, dep add, dep remove, gate approve, gate block, group create, fusion create, run, stop, restart.`
}

import type { Sequence } from '../sequence/schema'
import YAML from 'yaml'
import { CHAT_MUTATION_COMMANDS } from './commands'

const COMMAND_EXAMPLES: Record<(typeof CHAT_MUTATION_COMMANDS)[number], string> = {
  'step add': '- **step add** — Add a new step: { command: "step add", args: { id, name, type, model, prompt_file, depends_on? } }',
  'step remove': '- **step remove** — Remove a step: { command: "step remove", args: { id } }',
  'step update': '- **step update** — Update step fields: { command: "step update", args: { id, ...fields } }',
  'gate approve': '- **gate approve** — Approve a gate: { command: "gate approve", args: { id } }',
  'gate block': '- **gate block** — Block a gate: { command: "gate block", args: { id } }',
  'dep add': '- **dep add** — Add dependency: { command: "dep add", args: { from, to } }',
  'dep remove': '- **dep remove** — Remove dependency: { command: "dep remove", args: { from, to } }',
  'group create': '- **group create** — Create a group: { command: "group create", args: { id, step_ids } }',
  'fusion create': '- **fusion create** — Create fusion: { command: "fusion create", args: { candidate_ids, synth_id } }',
}

/**
 * Build a system prompt that teaches the LLM about thredOS capabilities
 * and the current sequence state.
 */
export function buildSystemPrompt(sequence: Sequence): string {
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
    })),
    gates: sequence.gates.map(g => ({
      id: g.id,
      name: g.name,
      status: g.status,
      depends_on: g.depends_on,
    })),
    policy: sequence.policy,
  })

  const commandReference = CHAT_MUTATION_COMMANDS.map(command => COMMAND_EXAMPLES[command])

  return `You are the thredOS Chat Orchestrator. You help users manage their AI agent sequences.

## Available Commands

${commandReference.join('\n')}

## Runtime Control Boundary

Do not propose runtime control commands such as run, stop, or restart in chat/apply. Use ThreadOSRuntimeService through the canonical workbench or CLI until chat delegation exists. When the user wants runtime control, direct them to the canonical workbench controls or CLI runtime surfaces instead.

## Step Types
- **base** — Single sequential agent
- **p** — Parallel: multiple agents, same task
- **c** — Chained: sequential pipeline
- **f** — Fusion: candidates + synthesis
- **b** — Baton: hand-off between agents
- **l** — Long-autonomy: extended autonomous operation

## Current Sequence State

\`\`\`yaml
${stateYaml}\`\`\`

## Output Format

Always respond with a JSON array of ProposedAction objects when suggesting changes:

\`\`\`json
[{ "command": "step add", "args": { "id": "my-step", "name": "My Step", "type": "base", "model": "claude-code", "prompt_file": "prompts/my-step.md" } }]
\`\`\`

## Safety Rules

1. **NEVER auto-execute actions** — always propose and wait for user approval
2. Respect policy constraints (safe_mode, max_parallel, etc.)
3. Validate dependencies won't create cycles
4. Warn about destructive operations (removing steps with dependents)
5. When in doubt, ask for clarification`
}

# Thread Types Guide

thredOS supports six thread types, each representing a different multi-agent coordination pattern.

## Base (`base`)

Single sequential agent. The simplest pattern — one agent, one task.

**Use cases:**
- Simple code generation
- Document writing
- One-off analysis

```yaml
- id: write-docs
  type: base
  model: claude-code
  prompt_file: prompts/docs.md
```

## Parallel (`p`)

Multiple agents working on the same task simultaneously. Results can be compared or merged.

**Use cases:**
- Getting multiple perspectives on a problem
- Redundant code review
- A/B testing approaches

```yaml
- id: review-a
  type: p
  model: claude-code
  prompt_file: prompts/review.md
  group_id: reviews
- id: review-b
  type: p
  model: codex
  prompt_file: prompts/review.md
  group_id: reviews
```

## Chained (`c`)

Sequential pipeline where each agent's output feeds the next.

**Use cases:**
- Research → Draft → Edit → Publish
- Analyze → Plan → Implement → Test
- Extract → Transform → Load

```yaml
- id: research
  type: c
  prompt_file: prompts/research.md
- id: draft
  type: c
  depends_on: [research]
  prompt_file: prompts/draft.md
- id: edit
  type: c
  depends_on: [draft]
  prompt_file: prompts/edit.md
```

## Fusion (`f`)

Multiple candidates generate solutions, then a synthesis step merges the best parts.

**Use cases:**
- Architecture design (multiple proposals → best-of synthesis)
- Creative writing (multiple drafts → combined version)
- Code generation with quality synthesis

```yaml
- id: candidate-1
  type: f
  fusion_candidates: true
  prompt_file: prompts/solution.md
- id: candidate-2
  type: f
  fusion_candidates: true
  prompt_file: prompts/solution.md
- id: synthesize
  type: f
  fusion_synth: true
  depends_on: [candidate-1, candidate-2]
  prompt_file: prompts/synthesize.md
```

## Baton (`b`)

Hand-off pattern where agents take turns, passing context forward.

**Use cases:**
- Code review → fix → re-review cycles
- Iterative refinement with different models
- Expert hand-off (specialist A → specialist B)

```yaml
- id: initial-draft
  type: b
  model: claude-code
  prompt_file: prompts/draft.md
- id: expert-review
  type: b
  depends_on: [initial-draft]
  model: gemini
  prompt_file: prompts/review.md
```

## Long-Autonomy (`l`)

Extended autonomous operation with watchdog monitoring.

**Use cases:**
- Long-running code generation projects
- Autonomous research with periodic check-ins
- Background monitoring and maintenance

```yaml
- id: autonomous-build
  type: l
  timeout_ms: 3600000
  prompt_file: prompts/build.md
- id: watchdog
  type: l
  watchdog_for: autonomous-build
  prompt_file: prompts/watchdog.md
```

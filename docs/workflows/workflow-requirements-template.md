# Workflow Requirements Template for thredOS Packs

Use this template when turning a workflow document into a thredOS-native pack. The goal is to ensure the workflow is complete enough that thredOS can compile it, validate it, and eventually execute it with minimal hidden assumptions.

---

## 1. Workflow identity

- **workflow_id**: kebab-case canonical ID
- **name**: user-facing name
- **version**: semantic version
- **goal**: one-sentence outcome
- **owner**: team / user / system owner

## 2. Entry conditions

- What user request or trigger starts the workflow?
- What files or input documents must already exist?
- What fields are mandatory vs optional?
- What does the runtime need to know before it can even start?

## 3. Prerequisites

For each external dependency provide:
- **name**
- **type** (`composio`, `direct_api`, `local`)
- **required**
- **health_check**
- **on_unavailable** (`abort`, `skip_dependent_steps`, `warn`)

Also list:
- required env vars
- static IDs / account IDs / destination IDs

## 4. Shared references

List every reference document the workflow depends on.

For each:
- **id**
- **path**
- **load_when** (`setup`, `during_merge`, `during_output`, etc.)
- **required**
- one-line purpose

If a workflow depends on tribal knowledge not captured in a reference file, the workflow is not ready.

## 5. Phase map

Define the user-visible stages in order.

For each phase:
- **id**
- **label**
- **order**
- objective
- entry condition
- exit condition

## 6. Step graph

For every step provide:
- **id** (kebab-case only)
- **name**
- **phase**
- **type**
- **model**
- **surface_class**
- **depends_on**
- **execution** (`sequential`, `parallel`, `sub_agent`)
- **timeout_ms**
- **condition** (if conditional)

If the sequence cannot be drawn as a DAG, it is not ready.

## 7. Action contract per step

Each step must declare what it actually does.

For each action provide:
- **id**
- **type** (`cli`, `composio_tool`, `sub_agent`, `approval`, `conditional`, `write_file`, etc.)
- **description**
- **config**
- **retry** policy
- **output_key**
- **on_failure**

If the step only says "do the thing" in prose, it is not ready.

## 8. Gates

Each important boundary needs an explicit gate.

For each gate provide:
- **id**
- **step_id**
- **when** (`pre`, `post`)
- **type** (`hard`, `soft`, `approval`)
- **check**
- **on_fail**
- **message**
- retry semantics if relevant

If a workflow has quality requirements but no explicit gates, it is not ready.

## 9. Budgets and timeouts

List all operational constraints explicitly.

Examples:
- API credit cap
- search-call cap
- contacts processed cap
- workflow maximum duration
- step timeout
- approval wait timeout

## 10. Output contracts

State exactly what artifacts must exist at the end.

For each output:
- filename / output key
- schema or required fields
- who consumes it next
- whether it is operator-facing or machine-facing

## 11. Operator experience requirements

Document what the user should experience in thredOS.

Examples:
- what inputs the UI/form must ask for
- what warnings should surface early
- what gates require human review
- what summary should be shown at completion
- what should be recoverable after failure

## 12. Anti-ambiguity checklist

Before calling a workflow pack-ready, confirm:
- [ ] all prerequisites are explicit
- [ ] all reference docs exist
- [ ] all steps have action contracts
- [ ] all quality boundaries have gates
- [ ] all timeouts/budgets are explicit
- [ ] all IDs are canonical and kebab-case
- [ ] no hidden operator assumptions remain
- [ ] a user could complete the workflow inside thredOS without leaving the platform for undocumented context

---

## Core rule

A workflow document is only good enough for thredOS when it is specific enough to compile into a pack and clear enough that the runtime and UI can guide the user to the right outcome.

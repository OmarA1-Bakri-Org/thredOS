import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { ZodError } from 'zod'
import { loadPack } from './loader'

const VALID_PACK_YAML = `
id: test-pack
version: 1.0.0
name: Test Pack
thread_types:
  - base
  - p
default_policy: SAFE
agents:
  - agent-one
prerequisites:
  connections:
    - name: apollo
      type: composio
      required: true
      health_check: APOLLO_VIEW_API_USAGE_STATS
      on_unavailable: abort
  env_vars:
    - APOLLO_API_KEY
  key_ids:
    telegram_chat_id: "1778273779"
shared_references:
  - id: compliance-rules
    path: shared_references/compliance-rules.md
    load_when: before-merge
    required: true
rate_limits:
  apollo_enrichment_credits:
    max: 20
    per: session
    enforce: soft
    current_check: APOLLO_VIEW_API_USAGE_STATS
    on_breach: skip_remaining
timeouts:
  workflow_max_ms: 1800000
  step_default_ms: 300000
  api_call_ms: 30000
  approval_wait_ms: 0
gates:
  - id: context7-loaded
    step_id: step-one
    when: post
    type: soft
    check: context7.docs_loaded == true
    on_fail: warn
    message: Context7 docs not loaded
surface_classes:
  - shared
  - sealed
phases:
  - id: phase-alpha
    label: Alpha Phase
    order: 0
  - id: phase-beta
    label: Beta Phase
    order: 1
steps:
  - id: step-one
    name: Step One
    type: base
    model: gpt-4o
    phase: phase-alpha
    execution: sequential
    timeout_ms: 30000
    condition: first_run == true
    surface_class: shared
    depends_on: []
    actions:
      - id: run-step-one
        type: cli
        description: Run step one command
        config:
          command: echo hello
        output_key: greeting
        on_failure: warn
  - id: step-two
    name: Step Two
    type: p
    model: gpt-4o
    phase: phase-beta
    execution: sub_agent
    surface_class: sealed
    depends_on:
      - step-one
    actions:
      - id: delegate-step-two
        type: sub_agent
        description: Delegate the work
        config:
          prompt: Do step two
          subagent_type: researcher
        on_failure: abort_workflow
gate_sets: []
`

describe('loadPack', () => {
  let basePath: string

  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'threados-loader-test-'))
  })

  afterEach(async () => {
    await rm(basePath, { recursive: true, force: true })
  })

  test('loads a valid pack.yaml and returns parsed manifest', async () => {
    const packDir = join(basePath, '.threados/packs/test-pack/1.0.0')
    await mkdir(packDir, { recursive: true })
    await writeFile(join(packDir, 'pack.yaml'), VALID_PACK_YAML, 'utf-8')

    const manifest = await loadPack(basePath, 'test-pack', '1.0.0')

    expect(manifest.id).toBe('test-pack')
    expect(manifest.version).toBe('1.0.0')
    expect(manifest.name).toBe('Test Pack')
    expect(manifest.thread_types).toEqual(['base', 'p'])
    expect(manifest.default_policy).toBe('SAFE')
    expect(manifest.agents).toEqual(['agent-one'])
    expect(manifest.prerequisites).toEqual({
      connections: [{
        name: 'apollo',
        type: 'composio',
        required: true,
        health_check: 'APOLLO_VIEW_API_USAGE_STATS',
        on_unavailable: 'abort',
      }],
      env_vars: ['APOLLO_API_KEY'],
      key_ids: { telegram_chat_id: '1778273779' },
    })
    expect(manifest.shared_references).toEqual([
      {
        id: 'compliance-rules',
        path: 'shared_references/compliance-rules.md',
        load_when: 'before-merge',
        required: true,
      },
    ])
    expect(manifest.rate_limits).toEqual({
      apollo_enrichment_credits: {
        max: 20,
        per: 'session',
        enforce: 'soft',
        current_check: 'APOLLO_VIEW_API_USAGE_STATS',
        on_breach: 'skip_remaining',
      },
    })
    expect(manifest.timeouts).toEqual({
      workflow_max_ms: 1800000,
      step_default_ms: 300000,
      api_call_ms: 30000,
      approval_wait_ms: 0,
    })
    expect(manifest.gates).toEqual([
      {
        id: 'context7-loaded',
        step_id: 'step-one',
        when: 'post',
        type: 'soft',
        check: 'context7.docs_loaded == true',
        on_fail: 'warn',
        message: 'Context7 docs not loaded',
      },
    ])
    expect(manifest.phases).toHaveLength(2)
    expect(manifest.phases[0]).toEqual({ id: 'phase-alpha', label: 'Alpha Phase', order: 0 })
    expect(manifest.steps).toHaveLength(2)
    expect(manifest.steps[0].id).toBe('step-one')
    expect(manifest.steps[0].execution).toBe('sequential')
    expect(manifest.steps[0].timeout_ms).toBe(30000)
    expect(manifest.steps[0].condition).toBe('first_run == true')
    expect(manifest.steps[0].actions).toEqual([
      {
        id: 'run-step-one',
        type: 'cli',
        description: 'Run step one command',
        config: { command: 'echo hello' },
        output_key: 'greeting',
        on_failure: 'warn',
      },
    ])
    expect(manifest.steps[1].id).toBe('step-two')
    expect(manifest.steps[1].execution).toBe('sub_agent')
    expect(manifest.steps[1].actions).toEqual([
      {
        id: 'delegate-step-two',
        type: 'sub_agent',
        description: 'Delegate the work',
        config: { prompt: 'Do step two', subagent_type: 'researcher' },
        on_failure: 'abort_workflow',
      },
    ])
    expect(manifest.steps[1].depends_on).toEqual(['step-one'])
    expect(manifest.steps[1].surface_class).toBe('sealed')
  })

  test('throws for missing pack file', async () => {
    await expect(loadPack(basePath, 'nonexistent-pack', '1.0.0')).rejects.toThrow()
  })

  test('rejects semantic pack validation failures with explicit diagnostics', async () => {
    const packDir = join(basePath, '.threados/packs/test-pack/1.0.0')
    await mkdir(packDir, { recursive: true })
    await writeFile(join(packDir, 'pack.yaml'), VALID_PACK_YAML.replace('phase: phase-beta', 'phase: missing-phase'), 'utf-8')

    try {
      await loadPack(basePath, 'test-pack', '1.0.0')
      throw new Error('expected loadPack to reject invalid semantic refs')
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError)
      const zodError = error as ZodError
      expect(zodError.issues).toContainEqual(expect.objectContaining({
        path: ['steps', 1, 'phase'],
        message: 'Unknown phase "missing-phase"',
      }))
    }
  })
})

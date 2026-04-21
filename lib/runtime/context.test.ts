import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildConditionContext, evaluateRuntimeCondition, hydrateApolloApprovalRuntimeContext } from './context'
import type { Sequence } from '../sequence/schema'

const baseSequence: Sequence = {
  id: 'seq-test',
  version: '1.0',
  name: 'runtime-test',
  steps: [],
  deps: [],
  gates: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  policy: undefined,
  metadata: undefined,
  pack_id: null,
  pack_version: null,
  default_policy_ref: null,
}

describe('runtime condition evaluation', () => {
  test('supports first_run, contains, string, boolean, null, number, and .length traversal', () => {
    const context = buildConditionContext({
      ...baseSequence,
      steps: [
        {
          id: 'only-step',
          name: 'Only Step',
          type: 'base',
          model: 'codex',
          prompt_file: '.threados/prompts/only-step.md',
          depends_on: [],
          status: 'READY',
          phase: 'default',
          surface_ref: 'thread-only-step',
          agent_ref: null,
          input_contract_ref: null,
          output_contract_ref: null,
          gate_set_ref: null,
          completion_contract: null,
          side_effect_class: 'none',
          actions: [],
          prompt_ref: { id: 'only-step', version: 1, path: '.threados/prompts/only-step.md' },
        },
      ],
    }, {
      icp_config: {
        sources: ['apollo_saved', 'apollo_discovery'],
        stage: 'active',
      },
      branch_selected: true,
      apollo_usage: {
        usage_remaining: 42,
        reset_at: null,
      },
    })

    expect(evaluateRuntimeCondition('first_run == true', context)).toBe(true)
    expect(evaluateRuntimeCondition("icp_config.sources contains 'apollo_discovery'", context)).toBe(true)
    expect(evaluateRuntimeCondition("icp_config.stage == 'active'", context)).toBe(true)
    expect(evaluateRuntimeCondition('branch_selected == true', context)).toBe(true)
    expect(evaluateRuntimeCondition('apollo_usage.reset_at == null', context)).toBe(true)
    expect(evaluateRuntimeCondition('apollo_usage.usage_remaining == 42', context)).toBe(true)
    expect(evaluateRuntimeCondition('icp_config.sources.length == 2', context)).toBe(true)
  })
})

describe('apollo approval runtime hydration', () => {
  let tempDir = ''
  let artifactDir = ''

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'apollo-runtime-context-'))
    artifactDir = join(tempDir, 'apollo-segment')
    await mkdir(artifactDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test('hydrates approval review fields from Apollo artifact files', async () => {
    await writeFile(join(artifactDir, 'qualified-segment.json'), JSON.stringify({
      segment_name: 'Enterprise Security',
      total_qualified: 4,
      contacts: [
        { source: 'apollo_saved', persona_lane: 'A' },
        { source: 'apollo_discovery', persona_lane: 'B' },
        { source: 'both', persona_lane: 'A' },
        { source: ['apollo_saved', 'apollo_discovery'], persona_lane: 'E' },
      ],
      excluded: {
        dnc: 3,
        recently_contacted: 2,
        existing_pipeline: 1,
        special_handling: 4,
        non_omar_owned: 5,
        duplicates: 6,
      },
    }), 'utf-8')
    await writeFile(join(artifactDir, 'enriched-segment.json'), JSON.stringify({
      credits_used: 17,
      contacts: [{ id: 'c-1' }],
    }), 'utf-8')
    await writeFile(join(artifactDir, 'icp-config.json'), JSON.stringify({
      enrichment: { max_apollo_credits: 40 },
      output: { apollo_stage_name: 'Stage Alpha', tag_in_apollo: true },
    }), 'utf-8')

    const hydrated = await hydrateApolloApprovalRuntimeContext(tempDir, {
      apollo_artifact_dir: artifactDir,
    })

    expect(hydrated).toMatchObject({
      qualified_segment: {
        segment_name: 'Enterprise Security',
        total_qualified: 4,
      },
      counts: {
        saved: 1,
        discovery: 1,
        both: 2,
        A: 2,
        B: 1,
        C: 0,
        D: 0,
        E: 1,
      },
      excluded: {
        dnc: 3,
        recently_contacted: 2,
        existing_pipeline: 1,
        special_handling: 4,
        non_omar_owned: 5,
        duplicates: 6,
      },
      enriched_segment: {
        credits_used: 17,
      },
      icp_config: {
        enrichment: { max_apollo_credits: 40 },
        output: { apollo_stage_name: 'Stage Alpha', tag_in_apollo: true },
      },
      stage_id_or_MISSING: 'MISSING',
    })
  })

  test('prefers resolved_stage_id for stage_id_or_MISSING and preserves existing runtime values', async () => {
    await writeFile(join(artifactDir, 'qualified-segment.json'), JSON.stringify({
      contacts: [],
      excluded: {},
    }), 'utf-8')

    const hydrated = await hydrateApolloApprovalRuntimeContext(tempDir, {
      apollo_artifact_dir: artifactDir,
      resolved_stage_id: 'stage-123',
      icp_config: {
        output: {
          tag_in_apollo: true,
          apollo_stage_name: 'Existing Stage',
        },
      },
      enriched_segment: {
        credits_used: 9,
      },
    })

    expect(hydrated.stage_id_or_MISSING).toBe('stage-123')
    expect(hydrated.icp_config).toEqual({
      output: {
        tag_in_apollo: true,
        apollo_stage_name: 'Existing Stage',
      },
    })
    expect(hydrated.enriched_segment).toEqual({
      credits_used: 9,
    })
  })
})

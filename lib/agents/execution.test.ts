import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rename, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildAgentComposition } from './composition'
import { readAgentState, writeAgentState } from './repository'
import { agentRegistrationEvidence, readRegisteredPrompt, resolveStepAgent } from './execution'
import type { Step } from '../sequence/schema'
import { setSafeIoBeforeOpenHookForTests } from '../security/safe-io'

const roots: string[] = []
afterEach(async () => {
  setSafeIoBeforeOpenHookForTests(null)
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'threados-agent-execution-'))
  roots.push(base)
  const promptRef = { id: 'canonical', version: 2, path: '.threados/prompts/canonical.md' }
  const skillRefs = [{ id: 'files', version: 1, path: '.threados/skills/files/SKILL.md', capabilities: ['read'] }]
  const composition = buildAgentComposition({ model: 'shell', role: 'builder', promptRef, skillRefs, tools: ['files'] })
  await mkdir(join(base, '.threados/prompts'), { recursive: true })
  await mkdir(join(base, '.threados/skills/files'), { recursive: true })
  await writeFile(join(base, promptRef.path), 'canonical command')
  await writeFile(join(base, skillRefs[0]!.path), 'registered skill')
  await writeAgentState(base, { version: 1, agents: [{
    id: 'registered', name: 'Registered', builderId: 'builder', builderName: 'Builder',
    registeredAt: '2026-01-01T00:00:00.000Z', version: 3, supersedesAgentId: 'previous',
    threadSurfaceIds: [], composition,
  }] })
  const step = { id: 'step-name', model: 'shell', agent_ref: 'registered', assigned_agent_id: 'registered',
    prompt_ref: promptRef, prompt_file: '.threados/prompts/step-name.md', skill_refs: skillRefs } as Step
  return { base, step }
}

describe('registered execution identity', () => {
  test('freezes registration version, composition, lineage and asset digests from the existing registry', async () => {
    const { base, step } = await fixture()
    const { registration, step: bound } = await resolveStepAgent(base, step)
    expect(registration).toMatchObject({ registration_id: 'registered', registration_version: 3,
      builder_id: 'builder', supersedes_agent_id: 'previous', model: 'shell', role: 'builder' })
    expect(registration.composition_hash).toHaveLength(64)
    expect(registration.prompt_content_hash).toHaveLength(64)
    expect(registration.skill_content_hashes).toHaveLength(1)
    expect(bound.prompt_file).toBe('.threados/prompts/canonical.md')
    expect(await readRegisteredPrompt(base, registration)).toBe('canonical command')
    expect(JSON.stringify(agentRegistrationEvidence(registration))).not.toContain('.threados')
  })

  test('rejects missing registration, unknown registration and conflicting aliases', async () => {
    const { base, step } = await fixture()
    await expect(resolveStepAgent(base, { ...step, assigned_agent_id: undefined, agent_ref: null }))
      .rejects.toMatchObject({ code: 'AGENT_REGISTRATION_REQUIRED' })
    await expect(resolveStepAgent(base, { ...step, assigned_agent_id: 'unknown', agent_ref: 'unknown' }))
      .rejects.toMatchObject({ code: 'AGENT_NOT_REGISTERED' })
    await expect(resolveStepAgent(base, { ...step, agent_ref: 'other' }))
      .rejects.toMatchObject({ code: 'AGENT_COMPOSITION_MISMATCH' })
  })

  test('rejects a different model, role, prompt version or attached skills under the same identity', async () => {
    const { base, step } = await fixture()
    for (const change of [{ model: 'codex' }, { role: 'other' }, { prompt_ref: { ...step.prompt_ref!, version: 9 } }, { skill_refs: [] }]) {
      await expect(resolveStepAgent(base, { ...step, ...change })).rejects.toMatchObject({ code: 'AGENT_COMPOSITION_MISMATCH' })
    }
  })

  test('retry uses frozen registration even if the live assignment changes', async () => {
    const { base, step } = await fixture()
    const { registration } = await resolveStepAgent(base, step)
    const retried = await resolveStepAgent(base, { ...step, assigned_agent_id: 'new-agent', agent_ref: 'new-agent', model: 'codex' }, registration)
    expect(retried.registration).toEqual(registration)
    expect(retried.step).toMatchObject({ assigned_agent_id: 'registered', model: 'shell' })
  })

  test('retry rejects deleted registrations and in-place identity or prompt/skill edits', async () => {
    const { base, step } = await fixture()
    const { registration } = await resolveStepAgent(base, step)
    await writeFile(join(base, '.threados/prompts/canonical.md'), 'changed command')
    await expect(resolveStepAgent(base, step, registration)).rejects.toMatchObject({ code: 'AGENT_IDENTITY_CHANGED' })
    await writeFile(join(base, '.threados/prompts/canonical.md'), 'canonical command')
    await writeFile(join(base, '.threados/skills/files/SKILL.md'), 'changed skill')
    await expect(resolveStepAgent(base, step, registration)).rejects.toMatchObject({ code: 'AGENT_IDENTITY_CHANGED' })
    const state = await readAgentState(base)
    await writeAgentState(base, { ...state, agents: [] })
    await expect(resolveStepAgent(base, step, registration)).rejects.toMatchObject({ code: 'AGENT_NOT_REGISTERED' })
  })

  test('canonical assets cannot escape through a registered path or symlink', async () => {
    const { base, step } = await fixture()
    const state = await readAgentState(base)
    const agent = state.agents[0]!
    agent.composition!.promptRef!.path = '../outside.md'
    await writeAgentState(base, state)
    await expect(resolveStepAgent(base, step)).rejects.toMatchObject({ code: 'AGENT_REGISTRATION_INVALID' })
    agent.composition!.promptRef!.path = '.threados/prompts/escape.md'
    await symlink(join(base, '../outside.md'), join(base, '.threados/prompts/escape.md'))
    await writeAgentState(base, state)
    await expect(resolveStepAgent(base, step)).rejects.toMatchObject({ code: 'AGENT_REGISTRATION_INVALID' })
  })

  test('rejects a prompt parent swapped outside the project at the open boundary', async () => {
    const { base, step } = await fixture()
    const outside = await mkdtemp(join(tmpdir(), 'threados-agent-outside-'))
    roots.push(outside)
    await writeFile(join(outside, 'canonical.md'), 'outside command must never execute')
    let swapped = false
    setSafeIoBeforeOpenHookForTests(async ({ filePath, operation }) => {
      if (!swapped && operation === 'read' && filePath === join(base, '.threados/prompts/canonical.md')) {
        await rename(join(base, '.threados/prompts'), join(base, '.threados/prompts-original'))
        await symlink(outside, join(base, '.threados/prompts'), 'junction')
        swapped = true
      }
    })
    await expect(resolveStepAgent(base, step)).rejects.toMatchObject({ code: 'AGENT_REGISTRATION_INVALID' })
    expect(swapped).toBe(true)
  })
})

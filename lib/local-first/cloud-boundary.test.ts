import { describe, expect, test } from 'bun:test'
import { collectForbiddenCloudKeys, sanitizeAgentForCloud, sanitizePerformanceForCloud } from './cloud-boundary'
import type { AgentRegistration } from '@/lib/agents/types'

describe('cloud boundary', () => {
  test('sanitizeAgentForCloud keeps only allowed canonical agent fields', () => {
    const agent: AgentRegistration = {
      id: 'agent-1',
      name: 'Launch Agent',
      registeredAt: '2026-03-20T10:00:00.000Z',
      builderId: 'builder-1',
      builderName: 'Founder',
      threadSurfaceIds: ['root'],
      metadata: {
        workflowContent: 'should-never-sync',
        prompt: 'nope',
      },
      model: 'gpt-5.2',
      role: 'research',
      tools: ['browser'],
      skillRefs: [{ id: 'spawn-reviewer', version: 1, capabilities: ['spawn'] }],
      composition: {
        model: 'gpt-5.2',
        role: 'research',
        skillRefs: [{ id: 'spawn-reviewer', version: 1, capabilities: ['spawn'] }],
        tools: ['browser'],
        identityHash: 'hash-1',
      },
      version: 2,
    }

    const payload = sanitizeAgentForCloud(agent, {
      registrationNumber: 'AG-20260320-0001',
      identityHash: 'hash-1',
      version: 2,
      registeredAt: '2026-03-20T10:00:00.000Z',
      supersedesRegistrationNumber: null,
    })

    expect(payload).toEqual({
      registrationNumber: 'AG-20260320-0001',
      agentId: 'agent-1',
      identityHash: 'hash-1',
      version: 2,
      registeredAt: '2026-03-20T10:00:00.000Z',
      supersedesRegistrationNumber: null,
      name: 'Launch Agent',
      model: 'gpt-5.2',
      role: 'research',
      skillIds: ['spawn-reviewer'],
      tools: ['browser'],
    })
  })

  test('forbidden keys are detected in cloud payload candidates', () => {
    const forbidden = collectForbiddenCloudKeys({
      registrationNumber: 'AG-20260320-0001',
      prompt: '# secret prompt',
      nested: {
        workspacePath: 'C:\\workspace',
        artifact: 'screenshot.png',
      },
    })

    expect(forbidden.sort()).toEqual(['artifact', 'prompt', 'workspacePath'])
  })

  test('sanitizePerformanceForCloud keeps only allowed performance fields', () => {
    const payload = sanitizePerformanceForCloud({
      id: 'perf-1',
      registrationNumber: 'AG-20260320-0001',
      recordedAt: '2026-03-20T10:00:00.000Z',
      outcome: 'pass',
      durationMs: 4500,
      qualityScore: 9,
      notes: 'Strong run',
    })

    expect(payload.qualityScore).toBe(9)
    expect(payload.outcome).toBe('pass')
  })
})

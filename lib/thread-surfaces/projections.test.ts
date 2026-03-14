import { describe, expect, test } from 'bun:test'
import type { MergeEvent, RunScope, ThreadSurface } from './types'
import type { AgentRegistration } from '../agents/types'
import { hasSpawnSkill, projectHierarchy, projectLaneBoard, projectSkills, resolveDefaultDisplayRun, resolveSkillsForAgent } from './projections'

const surfaces: ThreadSurface[] = [
  {
    id: 'thread-master',
    parentSurfaceId: null,
    parentAgentNodeId: null,
    depth: 0,
    surfaceLabel: 'Master',
    createdAt: '2026-03-09T00:00:00.000Z',
    childSurfaceIds: ['thread-research', 'thread-outreach', 'thread-synthesis'],
    sequenceRef: null,
    spawnedByAgentId: null,
  },
  {
    id: 'thread-research',
    parentSurfaceId: 'thread-master',
    parentAgentNodeId: 'spawn-research',
    depth: 1,
    surfaceLabel: 'Research',
    createdAt: '2026-03-09T00:01:00.000Z',
    childSurfaceIds: [],
    sequenceRef: null,
    spawnedByAgentId: null,
  },
  {
    id: 'thread-outreach',
    parentSurfaceId: 'thread-master',
    parentAgentNodeId: 'spawn-outreach',
    depth: 1,
    surfaceLabel: 'Outreach',
    createdAt: '2026-03-09T00:02:00.000Z',
    childSurfaceIds: [],
    sequenceRef: null,
    spawnedByAgentId: null,
  },
  {
    id: 'thread-synthesis',
    parentSurfaceId: 'thread-master',
    parentAgentNodeId: 'spawn-synthesis',
    depth: 1,
    surfaceLabel: 'Synthesis',
    createdAt: '2026-03-09T00:03:00.000Z',
    childSurfaceIds: [],
    sequenceRef: null,
    spawnedByAgentId: null,
  },
]

describe('thread surface projections', () => {
  test('projectHierarchy stays structural and emits parent-child edges', () => {
    const hierarchy = projectHierarchy(surfaces)

    expect(hierarchy.nodes.map(node => node.id)).toEqual([
      'thread-master',
      'thread-research',
      'thread-outreach',
      'thread-synthesis',
    ])
    expect(hierarchy.edges).toEqual([
      { source: 'thread-master', target: 'thread-research' },
      { source: 'thread-master', target: 'thread-outreach' },
      { source: 'thread-master', target: 'thread-synthesis' },
    ])
    expect(hierarchy.nodes[0]).not.toHaveProperty('runStatus')
  })

  test('resolveDefaultDisplayRun prefers active, then latest successful, then latest terminal', () => {
    const terminalRuns: RunScope[] = [
      {
        id: 'run-failed',
        threadSurfaceId: 'thread-master',
        runStatus: 'failed',
        startedAt: '2026-03-09T00:00:00.000Z',
        endedAt: '2026-03-09T00:10:00.000Z',
        parentRunId: null,
        childIndex: null,
      },
      {
        id: 'run-success',
        threadSurfaceId: 'thread-master',
        runStatus: 'successful',
        startedAt: '2026-03-09T01:00:00.000Z',
        endedAt: '2026-03-09T01:10:00.000Z',
        parentRunId: null,
        childIndex: null,
      },
      {
        id: 'run-cancelled',
        threadSurfaceId: 'thread-master',
        runStatus: 'cancelled',
        startedAt: '2026-03-09T02:00:00.000Z',
        endedAt: '2026-03-09T02:05:00.000Z',
        parentRunId: null,
        childIndex: null,
      },
    ]

    expect(resolveDefaultDisplayRun(terminalRuns)?.id).toBe('run-success')

    const withActiveRun: RunScope[] = [
      ...terminalRuns,
      {
        id: 'run-active',
        threadSurfaceId: 'thread-master',
        runStatus: 'running',
        startedAt: '2026-03-09T03:00:00.000Z',
        endedAt: null,
        parentRunId: null,
        childIndex: null,
      },
    ]

    expect(resolveDefaultDisplayRun(withActiveRun)?.id).toBe('run-active')

    const noSuccessRuns = terminalRuns.filter(run => run.id !== 'run-success')
    expect(resolveDefaultDisplayRun(noSuccessRuns)?.id).toBe('run-cancelled')
  })

  test('projectLaneBoard is run-scoped and keeps merge ordering truthful', () => {
    const runs: RunScope[] = [
      {
        id: 'run-old-master',
        threadSurfaceId: 'thread-master',
        runStatus: 'successful',
        startedAt: '2026-03-08T00:00:00.000Z',
        endedAt: '2026-03-08T00:10:00.000Z',
        executionIndex: 1,
        parentRunId: null,
        childIndex: null,
      },
      {
        id: 'run-master',
        threadSurfaceId: 'thread-master',
        runStatus: 'successful',
        startedAt: '2026-03-09T00:00:00.000Z',
        endedAt: '2026-03-09T00:10:00.000Z',
        executionIndex: 15,
        parentRunId: null,
        childIndex: null,
      },
      {
        id: 'run-research',
        threadSurfaceId: 'thread-research',
        runStatus: 'successful',
        startedAt: '2026-03-09T00:01:00.000Z',
        endedAt: '2026-03-09T00:04:00.000Z',
        executionIndex: 12,
        parentRunId: null,
        childIndex: null,
      },
      {
        id: 'run-outreach',
        threadSurfaceId: 'thread-outreach',
        runStatus: 'successful',
        startedAt: '2026-03-09T00:02:00.000Z',
        endedAt: '2026-03-09T00:05:00.000Z',
        executionIndex: 13,
        parentRunId: null,
        childIndex: null,
      },
      {
        id: 'run-synthesis',
        threadSurfaceId: 'thread-synthesis',
        runStatus: 'running',
        startedAt: '2026-03-09T00:03:00.000Z',
        endedAt: null,
        executionIndex: 14,
        parentRunId: null,
        childIndex: null,
      },
    ]

    const mergeEvents: MergeEvent[] = [
      {
        id: 'merge-block',
        runId: 'run-synthesis',
        destinationThreadSurfaceId: 'thread-synthesis',
        sourceThreadSurfaceIds: ['thread-research', 'thread-outreach'],
        sourceRunIds: ['run-research', 'run-outreach'],
        mergeKind: 'block',
        executionIndex: 14,
        createdAt: '2026-03-09T00:06:00.000Z',
        summary: 'Research and outreach merge into synthesis',
      },
    ]

    const laneBoard = projectLaneBoard({
      threadSurfaces: surfaces,
      runs,
      mergeEvents,
      runIds: ['run-master', 'run-research', 'run-outreach', 'run-synthesis'],
    })

    expect(laneBoard.rows.map(row => row.threadSurfaceId)).toEqual([
      'thread-synthesis',
      'thread-research',
      'thread-outreach',
      'thread-master',
    ])
    expect(laneBoard.rows.find(row => row.threadSurfaceId === 'thread-research')).toMatchObject({
      runId: 'run-research',
      laneTerminalState: 'merged',
      mergedIntoThreadSurfaceId: 'thread-synthesis',
    })
    expect(laneBoard.rows.find(row => row.threadSurfaceId === 'thread-outreach')).toMatchObject({
      runId: 'run-outreach',
      laneTerminalState: 'merged',
      mergedIntoThreadSurfaceId: 'thread-synthesis',
    })
    expect(laneBoard.rows.find(row => row.threadSurfaceId === 'thread-master')).toMatchObject({
      runId: 'run-master',
      laneTerminalState: undefined,
    })
    expect(laneBoard.rows.some(row => row.runId === 'run-old-master')).toBe(false)
    expect(laneBoard.events).toEqual([
      {
        type: 'merge',
        runId: 'run-synthesis',
        executionIndex: 14,
        destinationThreadSurfaceId: 'thread-synthesis',
        sourceThreadSurfaceIds: ['thread-research', 'thread-outreach'],
        sourceRunIds: ['run-research', 'run-outreach'],
        mergeKind: 'block',
      },
    ])
  })

  test('projectLaneBoard uses source run identity when a source surface has multiple runs', () => {
    const runs: RunScope[] = [
      {
        id: 'run-master',
        threadSurfaceId: 'thread-master',
        runStatus: 'successful',
        startedAt: '2026-03-09T00:00:00.000Z',
        endedAt: '2026-03-09T00:10:00.000Z',
        executionIndex: 15,
        parentRunId: null,
        childIndex: null,
      },
      {
        id: 'run-research',
        threadSurfaceId: 'thread-research',
        runStatus: 'successful',
        startedAt: '2026-03-09T00:01:00.000Z',
        endedAt: '2026-03-09T00:04:00.000Z',
        executionIndex: 12,
        parentRunId: null,
        childIndex: null,
      },
      {
        id: 'run-outreach-old',
        threadSurfaceId: 'thread-outreach',
        runStatus: 'failed',
        startedAt: '2026-03-09T00:01:30.000Z',
        endedAt: '2026-03-09T00:02:00.000Z',
        executionIndex: 11,
        parentRunId: null,
        childIndex: null,
      },
      {
        id: 'run-outreach-current',
        threadSurfaceId: 'thread-outreach',
        runStatus: 'successful',
        startedAt: '2026-03-09T00:02:00.000Z',
        endedAt: '2026-03-09T00:05:00.000Z',
        executionIndex: 13,
        parentRunId: null,
        childIndex: null,
      },
      {
        id: 'run-synthesis',
        threadSurfaceId: 'thread-synthesis',
        runStatus: 'running',
        startedAt: '2026-03-09T00:03:00.000Z',
        endedAt: null,
        executionIndex: 14,
        parentRunId: null,
        childIndex: null,
      },
    ]

    const mergeEvents: MergeEvent[] = [
      {
        id: 'merge-block',
        runId: 'run-synthesis',
        destinationThreadSurfaceId: 'thread-synthesis',
        sourceThreadSurfaceIds: ['thread-research', 'thread-outreach'],
        sourceRunIds: ['run-research', 'run-outreach-current'],
        mergeKind: 'block',
        executionIndex: 14,
        createdAt: '2026-03-09T00:06:00.000Z',
      },
    ]

    const laneBoard = projectLaneBoard({
      threadSurfaces: surfaces,
      runs,
      mergeEvents,
      runIds: ['run-master', 'run-research', 'run-outreach-old', 'run-outreach-current', 'run-synthesis'],
    })

    expect(laneBoard.rows.find(row => row.runId === 'run-outreach-current')).toMatchObject({
      laneTerminalState: 'merged',
      mergedIntoThreadSurfaceId: 'thread-synthesis',
    })
    expect(laneBoard.rows.find(row => row.runId === 'run-outreach-old')).toMatchObject({
      laneTerminalState: undefined,
      mergedIntoThreadSurfaceId: undefined,
    })
    expect(laneBoard.events).toEqual([
      {
        type: 'merge',
        runId: 'run-synthesis',
        executionIndex: 14,
        destinationThreadSurfaceId: 'thread-synthesis',
        sourceThreadSurfaceIds: ['thread-research', 'thread-outreach'],
        sourceRunIds: ['run-research', 'run-outreach-current'],
        mergeKind: 'block',
      },
    ])
  })

  // ── Skill projection ──────────────────────────────────────────────

  test('resolveSkillsForAgent returns agent metadata skills with inherited flag preserved', () => {
    const agent: AgentRegistration = {
      id: 'agent-1',
      name: 'Research Agent',
      registeredAt: '2026-03-09T00:00:00.000Z',
      builderId: 'builder-1',
      builderName: 'TestBuilder',
      threadSurfaceIds: ['thread-research'],
      metadata: {
        skills: [
          { id: 'search', label: 'Search', inherited: false },
          { id: 'model', label: 'Model', inherited: true },
          { id: 'files', label: 'Files', inherited: true },
        ],
      },
    }

    const skills = resolveSkillsForAgent(agent)
    expect(skills).toHaveLength(3)

    const local = skills.filter(s => !s.inherited)
    const inherited = skills.filter(s => s.inherited)
    expect(local).toEqual([{ id: 'search', label: 'Search', inherited: false }])
    expect(inherited).toEqual([
      { id: 'model', label: 'Model', inherited: true },
      { id: 'files', label: 'Files', inherited: true },
    ])
  })

  test('resolveSkillsForAgent defaults inherited to false when not specified', () => {
    const agent: AgentRegistration = {
      id: 'agent-1',
      name: 'Minimal Agent',
      registeredAt: '2026-03-09T00:00:00.000Z',
      builderId: 'builder-1',
      builderName: 'TestBuilder',
      threadSurfaceIds: [],
      metadata: {
        skills: [{ id: 'tools', label: 'Tools' }],
      },
    }

    const skills = resolveSkillsForAgent(agent)
    expect(skills).toEqual([{ id: 'tools', label: 'Tools', inherited: false }])
  })

  test('resolveSkillsForAgent returns default skills when agent is null', () => {
    const skills = resolveSkillsForAgent(null)
    expect(skills.length).toBeGreaterThan(0)

    const local = skills.filter(s => !s.inherited)
    const inherited = skills.filter(s => s.inherited)
    expect(local.length).toBeGreaterThan(0)
    expect(inherited.length).toBeGreaterThan(0)
  })

  test('resolveSkillsForAgent returns defaults when agent has no metadata.skills', () => {
    const agent: AgentRegistration = {
      id: 'agent-1',
      name: 'No Skills Agent',
      registeredAt: '2026-03-09T00:00:00.000Z',
      builderId: 'builder-1',
      builderName: 'TestBuilder',
      threadSurfaceIds: [],
    }

    const skills = resolveSkillsForAgent(agent)
    expect(skills.length).toBeGreaterThan(0)
    expect(skills.some(s => s.inherited)).toBe(true)
    expect(skills.some(s => !s.inherited)).toBe(true)
  })

  test('projectSkills resolves skills for each surface from registered agents', () => {
    const surfacesWithAgents: ThreadSurface[] = [
      {
        id: 'ts-master',
        parentSurfaceId: null,
        parentAgentNodeId: null,
        depth: 0,
        surfaceLabel: 'Master',
        registeredAgentId: 'agent-master',
        createdAt: '2026-03-09T00:00:00.000Z',
        childSurfaceIds: ['ts-worker'],
        sequenceRef: null,
        spawnedByAgentId: null,
      },
      {
        id: 'ts-worker',
        parentSurfaceId: 'ts-master',
        parentAgentNodeId: 'spawn-worker',
        depth: 1,
        surfaceLabel: 'Worker',
        registeredAgentId: 'agent-worker',
        createdAt: '2026-03-09T00:01:00.000Z',
        childSurfaceIds: [],
        sequenceRef: null,
        spawnedByAgentId: null,
      },
    ]

    const agents: AgentRegistration[] = [
      {
        id: 'agent-master',
        name: 'Master Agent',
        registeredAt: '2026-03-09T00:00:00.000Z',
        builderId: 'builder-1',
        builderName: 'TestBuilder',
        threadSurfaceIds: ['ts-master'],
        metadata: {
          skills: [
            { id: 'orchestration', label: 'Orchestration', inherited: false },
            { id: 'model', label: 'Model', inherited: true },
          ],
        },
      },
      {
        id: 'agent-worker',
        name: 'Worker Agent',
        registeredAt: '2026-03-09T00:01:00.000Z',
        builderId: 'builder-1',
        builderName: 'TestBuilder',
        threadSurfaceIds: ['ts-worker'],
        metadata: {
          skills: [
            { id: 'search', label: 'Search', inherited: false },
            { id: 'files', label: 'Files', inherited: false },
            { id: 'model', label: 'Model', inherited: true },
          ],
        },
      },
    ]

    const projections = projectSkills(surfacesWithAgents, agents)

    expect(projections).toHaveLength(2)
    expect(projections[0]).toEqual({
      threadSurfaceId: 'ts-master',
      skills: [
        { id: 'orchestration', label: 'Orchestration', inherited: false },
        { id: 'model', label: 'Model', inherited: true },
      ],
    })
    expect(projections[1]).toEqual({
      threadSurfaceId: 'ts-worker',
      skills: [
        { id: 'search', label: 'Search', inherited: false },
        { id: 'files', label: 'Files', inherited: false },
        { id: 'model', label: 'Model', inherited: true },
      ],
    })
  })

  test('projectSkills returns defaults for surfaces without a registered agent', () => {
    const unregisteredSurface: ThreadSurface[] = [
      {
        id: 'ts-orphan',
        parentSurfaceId: null,
        parentAgentNodeId: null,
        depth: 0,
        surfaceLabel: 'Orphan',
        createdAt: '2026-03-09T00:00:00.000Z',
        childSurfaceIds: [],
        sequenceRef: null,
        spawnedByAgentId: null,
      },
    ]

    const projections = projectSkills(unregisteredSurface, [])

    expect(projections).toHaveLength(1)
    expect(projections[0].threadSurfaceId).toBe('ts-orphan')
    expect(projections[0].skills.length).toBeGreaterThan(0)
    expect(projections[0].skills.some(s => s.inherited)).toBe(true)
    expect(projections[0].skills.some(s => !s.inherited)).toBe(true)
  })

  // ── hasSpawnSkill ───────────────────────────────────────────────────

  test('hasSpawnSkill returns true when agent has spawn in metadata.skills', () => {
    const agent: AgentRegistration = {
      id: 'agt-1',
      name: 'Spawner',
      registeredAt: '2026-03-14T00:00:00.000Z',
      builderId: 'omar',
      builderName: 'Omar',
      threadSurfaceIds: [],
      metadata: {
        skills: [
          { id: 'search', label: 'Search', inherited: false },
          { id: 'spawn', label: 'Spawn', inherited: false },
        ],
      },
    }
    expect(hasSpawnSkill(agent)).toBe(true)
  })

  test('hasSpawnSkill returns false when agent has no spawn skill', () => {
    const agent: AgentRegistration = {
      id: 'agt-2',
      name: 'Worker',
      registeredAt: '2026-03-14T00:00:00.000Z',
      builderId: 'omar',
      builderName: 'Omar',
      threadSurfaceIds: [],
      metadata: {
        skills: [
          { id: 'search', label: 'Search', inherited: false },
        ],
      },
    }
    expect(hasSpawnSkill(agent)).toBe(false)
  })

  test('hasSpawnSkill returns false when agent is null', () => {
    expect(hasSpawnSkill(null)).toBe(false)
  })

  test('hasSpawnSkill returns false when agent has no metadata', () => {
    const agent: AgentRegistration = {
      id: 'agt-3',
      name: 'Bare',
      registeredAt: '2026-03-14T00:00:00.000Z',
      builderId: 'omar',
      builderName: 'Omar',
      threadSurfaceIds: [],
    }
    expect(hasSpawnSkill(agent)).toBe(false)
  })
})

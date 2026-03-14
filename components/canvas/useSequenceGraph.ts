'use client'

import { useState, useEffect, useMemo } from 'react'
import ELK from 'elkjs/lib/elk.bundled.js'
import type { Node, Edge } from '@xyflow/react'
import type { SequenceStatus } from '@/app/api/status/route'
import { STATUS_COLORS } from '@/lib/ui/constants'
import { derivePhases } from '@/lib/ui/phases'

const NODE_WIDTH = 220
const NODE_HEIGHT = 68
const GATE_SIZE = 96
const FUSION_WIDTH = 220
const FUSION_HEIGHT = 80
const GROUP_PADDING = 36

const elk = new ELK()

type StepItem = SequenceStatus['steps'][number]
type GateItem = SequenceStatus['gates'][number]

interface ElkNode { id: string; width: number; height: number }
interface ElkEdge { id: string; sources: string[]; targets: string[] }
interface GroupBounds { minX: number; minY: number; maxX: number; maxY: number }

export function useSequenceGraph(
  status: SequenceStatus | undefined,
  searchQuery: string,
  childCountByStepId?: Map<string, number>,
) {
  const [layoutResult, setLayoutResult] = useState<{ nodes: Node[]; edges: Edge[] }>({ nodes: [], edges: [] })

  const inputKey = useMemo(() => {
    if (!status) return ''
    return JSON.stringify({ steps: status.steps.map(s => s.id), gates: status.gates.map(g => g.id), searchQuery })
  }, [status, searchQuery])

  useEffect(() => {
    if (!status || !inputKey) return

    let cancelled = false
    const lowerQuery = searchQuery.toLowerCase()

    const stepMap = new Map(status.steps.map(s => [s.id, s]))
    const gateMap = new Map(status.gates.map(g => [g.id, g]))

    const { stepPhaseMap, gatePhaseMap } = buildPhaseMaps(status)
    const { elkNodes, elkEdges } = buildElkGraph(status, lowerQuery)

    const graph = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.spacing.nodeNode': '50',
        'elk.layered.spacing.nodeNodeBetweenLayers': '100',
        'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      },
      children: elkNodes,
      edges: elkEdges,
    }

    elk.layout(graph).then(layoutedGraph => {
      if (cancelled) return

      const nodes = buildLayoutNodes(layoutedGraph, stepMap, gateMap, stepPhaseMap, gatePhaseMap, childCountByStepId)
      const edges = buildLayoutEdges(layoutedGraph, stepMap, gateMap)

      setLayoutResult({ nodes, edges })
    })

    return () => { cancelled = true }
  }, [inputKey, status, searchQuery, childCountByStepId])

  if (!status) return { nodes: [] as Node[], edges: [] as Edge[] }
  return layoutResult
}

function buildPhaseMaps(status: SequenceStatus) {
  const phaseDerivation = derivePhases(status.steps, status.gates)
  const stepPhaseMap = new Map<string, string>()
  const gatePhaseMap = new Map<string, string>()
  for (const phase of phaseDerivation.phases) {
    for (const stepId of phase.stepIds) stepPhaseMap.set(stepId, phase.id)
    for (const gateId of phase.gateIds) gatePhaseMap.set(gateId, phase.id)
  }
  return { stepPhaseMap, gatePhaseMap }
}

function buildElkGraph(status: SequenceStatus, lowerQuery: string) {
  const elkNodes: ElkNode[] = []
  const elkEdges: ElkEdge[] = []
  const visibleIds = new Set<string>()

  for (const step of status.steps) {
    if (isNodeHidden(step, lowerQuery)) continue
    elkNodes.push(buildStepElkNode(step))
    visibleIds.add(step.id)
  }
  for (const gate of status.gates) {
    if (isNodeHidden(gate, lowerQuery)) continue
    elkNodes.push({ id: gate.id, width: GATE_SIZE, height: GATE_SIZE })
    visibleIds.add(gate.id)
  }

  addDependencyEdges(elkEdges, status.steps, visibleIds)
  addDependencyEdges(elkEdges, status.gates, visibleIds)

  return { elkNodes, elkEdges, visibleIds }
}

function isNodeHidden(item: { id: string; name: string }, lowerQuery: string): boolean {
  return !!lowerQuery && !item.id.toLowerCase().includes(lowerQuery) && !item.name.toLowerCase().includes(lowerQuery)
}

function buildStepElkNode(step: StepItem): ElkNode {
  const isFusionSynth = step.fusionSynth
  return {
    id: step.id,
    width: isFusionSynth ? FUSION_WIDTH : NODE_WIDTH,
    height: isFusionSynth ? FUSION_HEIGHT : NODE_HEIGHT,
  }
}

function addDependencyEdges(
  elkEdges: ElkEdge[],
  items: Array<{ id: string; dependsOn: string[] }>,
  visibleIds: Set<string>,
) {
  for (const item of items) {
    for (const dep of item.dependsOn) {
      if (visibleIds.has(item.id) && visibleIds.has(dep)) {
        elkEdges.push({ id: `${dep}->${item.id}`, sources: [dep], targets: [item.id] })
      }
    }
  }
}

function buildLayoutNodes(
  layoutedGraph: { children?: Array<{ id: string; x?: number; y?: number; width?: number; height?: number }> },
  stepMap: Map<string, StepItem>,
  gateMap: Map<string, GateItem>,
  stepPhaseMap: Map<string, string>,
  gatePhaseMap: Map<string, string>,
  childCountByStepId?: Map<string, number>,
): Node[] {
  const nodes: Node[] = []
  const groupMembers = new Map<string, GroupBounds>()

  for (const elkNode of layoutedGraph.children || []) {
    const x = elkNode.x ?? 0
    const y = elkNode.y ?? 0
    const step = stepMap.get(elkNode.id)
    const gate = gateMap.get(elkNode.id)

    if (step) {
      nodes.push(buildStepNode(elkNode, step, x, y, stepPhaseMap, childCountByStepId))
      if (step.groupId) updateGroupBounds(groupMembers, step.groupId, x, y, elkNode.width ?? NODE_WIDTH, elkNode.height ?? NODE_HEIGHT)
    } else if (gate) {
      nodes.push(buildGateNode(elkNode, gate, x, y, gatePhaseMap))
    }
  }

  addGroupBoundaryNodes(nodes, groupMembers)
  return nodes
}

function buildStepNode(
  elkNode: { id: string },
  step: StepItem,
  x: number,
  y: number,
  stepPhaseMap: Map<string, string>,
  childCountByStepId?: Map<string, number>,
): Node {
  const isFusionSynth = step.fusionSynth
  return {
    id: elkNode.id,
    type: isFusionSynth ? 'fusionNode' : 'stepNode',
    position: { x, y },
    data: { ...step, color: STATUS_COLORS[step.status] || '#94a3b8', phaseId: stepPhaseMap.get(step.id) ?? null, childCount: childCountByStepId?.get(step.id) ?? 0 },
  }
}

function buildGateNode(
  elkNode: { id: string },
  gate: GateItem,
  x: number,
  y: number,
  gatePhaseMap: Map<string, string>,
): Node {
  return {
    id: elkNode.id,
    type: 'gateNode',
    position: { x, y },
    data: { ...gate, color: STATUS_COLORS[gate.status] || '#94a3b8', phaseId: gatePhaseMap.get(gate.id) ?? null },
  }
}

function updateGroupBounds(
  groupMembers: Map<string, GroupBounds>,
  groupId: string,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const bounds = groupMembers.get(groupId)
  if (bounds) {
    bounds.minX = Math.min(bounds.minX, x)
    bounds.minY = Math.min(bounds.minY, y)
    bounds.maxX = Math.max(bounds.maxX, x + w)
    bounds.maxY = Math.max(bounds.maxY, y + h)
  } else {
    groupMembers.set(groupId, { minX: x, minY: y, maxX: x + w, maxY: y + h })
  }
}

function addGroupBoundaryNodes(nodes: Node[], groupMembers: Map<string, GroupBounds>) {
  for (const [groupId, bounds] of groupMembers) {
    nodes.unshift({
      id: `group-${groupId}`,
      type: 'groupBoundary',
      position: {
        x: bounds.minX - GROUP_PADDING,
        y: bounds.minY - GROUP_PADDING,
      },
      data: {
        groupId,
        width: bounds.maxX - bounds.minX + GROUP_PADDING * 2,
        height: bounds.maxY - bounds.minY + GROUP_PADDING * 2,
      },
      selectable: false,
      draggable: false,
      style: { zIndex: -1 },
    })
  }
}

function buildLayoutEdges(
  layoutedGraph: { edges?: Array<{ id: string; sources?: string[]; targets?: string[] }> },
  stepMap: Map<string, StepItem>,
  gateMap: Map<string, GateItem>,
): Edge[] {
  return (layoutedGraph.edges || []).map(e => {
    const sourceId = e.sources?.[0] ?? ''
    const targetId = e.targets?.[0] ?? ''
    const sourceStatus = stepMap.get(sourceId)?.status || gateMap.get(sourceId)?.status || 'READY'
    const color = STATUS_COLORS[sourceStatus] || '#94a3b8'
    return {
      id: e.id,
      source: sourceId,
      target: targetId,
      type: 'depEdge',
      style: { stroke: color, strokeWidth: 2 },
      animated: sourceStatus === 'RUNNING',
    }
  })
}

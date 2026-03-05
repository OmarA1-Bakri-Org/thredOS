'use client'

import { useMemo } from 'react'
import dagre from 'dagre'
import type { Node, Edge } from '@xyflow/react'
import type { SequenceStatus } from '@/app/api/status/route'
import { STATUS_COLORS } from '@/lib/ui/constants'

const NODE_WIDTH = 200
const NODE_HEIGHT = 60
const GATE_SIZE = 80
const FUSION_WIDTH = 200
const FUSION_HEIGHT = 80
const GROUP_PADDING = 30

export function useSequenceGraph(status: SequenceStatus | undefined, searchQuery: string) {
  return useMemo(() => {
    if (!status) return { nodes: [] as Node[], edges: [] as Edge[] }

    const g = new dagre.graphlib.Graph()
    g.setDefaultEdgeLabel(() => ({}))
    g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 80 })

    const lowerQuery = searchQuery.toLowerCase()

    for (const step of status.steps) {
      const hidden = lowerQuery && !step.id.toLowerCase().includes(lowerQuery) && !step.name.toLowerCase().includes(lowerQuery)
      if (!hidden) {
        const isFusionSynth = step.fusionSynth
        g.setNode(step.id, {
          width: isFusionSynth ? FUSION_WIDTH : NODE_WIDTH,
          height: isFusionSynth ? FUSION_HEIGHT : NODE_HEIGHT,
        })
      }
    }
    for (const gate of status.gates) {
      const hidden = lowerQuery && !gate.id.toLowerCase().includes(lowerQuery) && !gate.name.toLowerCase().includes(lowerQuery)
      if (!hidden) g.setNode(gate.id, { width: GATE_SIZE, height: GATE_SIZE })
    }

    // edges
    for (const step of status.steps) {
      for (const dep of step.dependsOn) {
        if (g.hasNode(step.id) && g.hasNode(dep)) g.setEdge(dep, step.id)
      }
    }
    for (const gate of status.gates) {
      for (const dep of gate.dependsOn) {
        if (g.hasNode(gate.id) && g.hasNode(dep)) g.setEdge(dep, gate.id)
      }
    }

    dagre.layout(g)

    const stepMap = new Map(status.steps.map(s => [s.id, s]))
    const gateMap = new Map(status.gates.map(g => [g.id, g]))

    const nodes: Node[] = []

    // Collect group positions for GroupBoundary nodes
    const groupMembers = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>()

    for (const id of g.nodes()) {
      const pos = g.node(id)
      const step = stepMap.get(id)
      const gate = gateMap.get(id)

      if (step) {
        const isFusionSynth = step.fusionSynth
        const w = isFusionSynth ? FUSION_WIDTH : NODE_WIDTH
        const h = isFusionSynth ? FUSION_HEIGHT : NODE_HEIGHT
        const x = pos.x - w / 2
        const y = pos.y - h / 2

        nodes.push({
          id,
          type: isFusionSynth ? 'fusionNode' : 'stepNode',
          position: { x, y },
          data: { ...step, color: STATUS_COLORS[step.status] || '#94a3b8' },
        })

        // Track group boundaries
        if (step.groupId) {
          const bounds = groupMembers.get(step.groupId)
          if (bounds) {
            bounds.minX = Math.min(bounds.minX, x)
            bounds.minY = Math.min(bounds.minY, y)
            bounds.maxX = Math.max(bounds.maxX, x + w)
            bounds.maxY = Math.max(bounds.maxY, y + h)
          } else {
            groupMembers.set(step.groupId, { minX: x, minY: y, maxX: x + w, maxY: y + h })
          }
        }
      } else if (gate) {
        nodes.push({
          id,
          type: 'gateNode',
          position: { x: pos.x - GATE_SIZE / 2, y: pos.y - GATE_SIZE / 2 },
          data: { ...gate, color: STATUS_COLORS[gate.status] || '#94a3b8' },
        })
      }
    }

    // Add GroupBoundary background nodes
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

    const edges: Edge[] = g.edges().map(e => {
      const sourceStatus = stepMap.get(e.v)?.status || gateMap.get(e.v)?.status || 'READY'
      const color = STATUS_COLORS[sourceStatus] || '#94a3b8'
      return {
        id: `${e.v}->${e.w}`, source: e.v, target: e.w, type: 'depEdge',
        style: { stroke: color, strokeWidth: 2 }, animated: sourceStatus === 'RUNNING',
      }
    })

    return { nodes, edges }
  }, [status, searchQuery])
}

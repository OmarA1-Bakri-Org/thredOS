'use client'

import { useState, useEffect, useMemo } from 'react'
import ELK from 'elkjs/lib/elk.bundled.js'
import type { Node, Edge } from '@xyflow/react'
import type { SequenceStatus } from '@/app/api/status/route'
import { STATUS_COLORS } from '@/lib/ui/constants'
import { derivePhases, findPhaseForStep, findPhaseForGate } from '@/lib/ui/phases'

const NODE_WIDTH = 220
const NODE_HEIGHT = 68
const GATE_SIZE = 96
const FUSION_WIDTH = 220
const FUSION_HEIGHT = 80
const GROUP_PADDING = 36

const elk = new ELK()

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

    // Derive phase membership for each node (used for panel ↔ canvas sync)
    const phaseDerivation = derivePhases(status.steps, status.gates)
    const stepPhaseMap = new Map<string, string>()
    const gatePhaseMap = new Map<string, string>()
    for (const phase of phaseDerivation.phases) {
      for (const stepId of phase.stepIds) stepPhaseMap.set(stepId, phase.id)
      for (const gateId of phase.gateIds) gatePhaseMap.set(gateId, phase.id)
    }

    const elkNodes: Array<{ id: string; width: number; height: number }> = []
    const elkEdges: Array<{ id: string; sources: string[]; targets: string[] }> = []
    const visibleIds = new Set<string>()

    for (const step of status.steps) {
      const hidden = lowerQuery && !step.id.toLowerCase().includes(lowerQuery) && !step.name.toLowerCase().includes(lowerQuery)
      if (!hidden) {
        const isFusionSynth = step.fusionSynth
        elkNodes.push({
          id: step.id,
          width: isFusionSynth ? FUSION_WIDTH : NODE_WIDTH,
          height: isFusionSynth ? FUSION_HEIGHT : NODE_HEIGHT,
        })
        visibleIds.add(step.id)
      }
    }
    for (const gate of status.gates) {
      const hidden = lowerQuery && !gate.id.toLowerCase().includes(lowerQuery) && !gate.name.toLowerCase().includes(lowerQuery)
      if (!hidden) {
        elkNodes.push({ id: gate.id, width: GATE_SIZE, height: GATE_SIZE })
        visibleIds.add(gate.id)
      }
    }

    for (const step of status.steps) {
      for (const dep of step.dependsOn) {
        if (visibleIds.has(step.id) && visibleIds.has(dep)) {
          elkEdges.push({ id: `${dep}->${step.id}`, sources: [dep], targets: [step.id] })
        }
      }
    }
    for (const gate of status.gates) {
      for (const dep of gate.dependsOn) {
        if (visibleIds.has(gate.id) && visibleIds.has(dep)) {
          elkEdges.push({ id: `${dep}->${gate.id}`, sources: [dep], targets: [gate.id] })
        }
      }
    }

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

      const nodes: Node[] = []
      const groupMembers = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>()

      for (const elkNode of layoutedGraph.children || []) {
        const x = elkNode.x ?? 0
        const y = elkNode.y ?? 0
        const step = stepMap.get(elkNode.id)
        const gate = gateMap.get(elkNode.id)

        if (step) {
          const isFusionSynth = step.fusionSynth
          nodes.push({
            id: elkNode.id,
            type: isFusionSynth ? 'fusionNode' : 'stepNode',
            position: { x, y },
            data: { ...step, color: STATUS_COLORS[step.status] || '#94a3b8', phaseId: stepPhaseMap.get(step.id) ?? null, childCount: childCountByStepId?.get(step.id) ?? 0 },
          })

          if (step.groupId) {
            const w = elkNode.width ?? NODE_WIDTH
            const h = elkNode.height ?? NODE_HEIGHT
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
            id: elkNode.id,
            type: 'gateNode',
            position: { x, y },
            data: { ...gate, color: STATUS_COLORS[gate.status] || '#94a3b8', phaseId: gatePhaseMap.get(gate.id) ?? null },
          })
        }
      }

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

      const edges: Edge[] = (layoutedGraph.edges || []).map(e => {
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

      setLayoutResult({ nodes, edges })
    })

    return () => { cancelled = true }
  }, [inputKey, status, searchQuery, childCountByStepId])

  if (!status) return { nodes: [] as Node[], edges: [] as Edge[] }
  return layoutResult
}

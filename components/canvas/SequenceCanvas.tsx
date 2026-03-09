'use client'

import { useEffect, useMemo } from 'react'
import { ReactFlow, ReactFlowProvider, MiniMap, Controls, Background, useReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useStatus, useThreadMerges, useThreadRuns, useThreadSurfaces } from '@/lib/ui/api'
import { useUIStore } from '@/lib/ui/store'
import { useSequenceGraph } from './useSequenceGraph'
import { StepNode } from './StepNode'
import { GateNode } from './GateNode'
import { GroupBoundary } from './GroupBoundary'
import { FusionMerge } from './FusionMerge'
import { DependencyEdge } from './DependencyEdge'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { EmptyState } from '@/components/EmptyState'
import { useHierarchyGraph } from '@/components/hierarchy/useHierarchyGraph'
import { HierarchyView } from '@/components/hierarchy/HierarchyView'
import { LaneBoardView } from '@/components/lanes/LaneBoardView'
import { createLaneBoardModel } from '@/components/lanes/useLaneBoard'
import { resolveThreadSurfaceCanvasData } from './threadSurfaceScaffold'

const nodeTypes = {
  stepNode: StepNode,
  gateNode: GateNode,
  groupBoundary: GroupBoundary,
  fusionNode: FusionMerge,
}
const edgeTypes = { depEdge: DependencyEdge }

function LegacySequenceFlow({ minimapVisible }: { minimapVisible: boolean }) {
  const { data: status, isLoading, isError } = useStatus()
  const searchQuery = useUIStore(s => s.searchQuery)
  const { nodes, edges } = useSequenceGraph(status, searchQuery)
  const { fitView } = useReactFlow()

  useEffect(() => {
    if (nodes.length > 0) {
      const t = setTimeout(() => fitView({ padding: 0.1 }), 50)
      return () => clearTimeout(t)
    }
  }, [nodes.length, fitView])

  if (isLoading) return <LoadingSpinner message="Loading sequence..." />
  if (isError) return <div className="flex h-full items-center justify-center text-sm text-destructive">Failed to load sequence status</div>
  if (!status || (status.steps.length === 0 && status.gates.length === 0)) return <EmptyState />

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      proOptions={{ hideAttribution: true }}
    >
      <Controls />
      <Background />
      {minimapVisible && <MiniMap />}
    </ReactFlow>
  )
}

function CanvasInner() {
  const { data: status, isLoading, isError } = useStatus()
  const { data: threadSurfaces } = useThreadSurfaces()
  const { data: runs } = useThreadRuns()
  const { data: mergeEvents } = useThreadMerges()
  const minimapVisible = useUIStore(s => s.minimapVisible)
  const viewMode = useUIStore(s => s.viewMode)
  const selectedThreadSurfaceId = useUIStore(s => s.selectedThreadSurfaceId)
  const selectedRunId = useUIStore(s => s.selectedRunId)
  const laneFocusThreadSurfaceId = useUIStore(s => s.laneFocusThreadSurfaceId)
  const openLaneViewForThreadSurface = useUIStore(s => s.openLaneViewForThreadSurface)
  const setLaneFocusThreadSurfaceId = useUIStore(s => s.setLaneFocusThreadSurfaceId)
  const setSelectedThreadSurfaceId = useUIStore(s => s.setSelectedThreadSurfaceId)
  const setSelectedRunId = useUIStore(s => s.setSelectedRunId)
  const setViewMode = useUIStore(s => s.setViewMode)

  const threadSurfaceData = useMemo(
    () => resolveThreadSurfaceCanvasData({ status, threadSurfaces, runs, mergeEvents }),
    [mergeEvents, runs, status, threadSurfaces],
  )
  const hasRealThreadSurfaceData = threadSurfaceData.source === 'api'
  const selectedRunIdBySurfaceId = useMemo(
    () => (selectedThreadSurfaceId && selectedRunId ? { [selectedThreadSurfaceId]: selectedRunId } : {}),
    [selectedRunId, selectedThreadSurfaceId],
  )

  const hierarchyGraph = useHierarchyGraph({
    threadSurfaces: threadSurfaceData.threadSurfaces,
    runs: threadSurfaceData.runs,
    zoom: 1,
    selectedRunIdBySurfaceId,
  })

  const laneBoard = createLaneBoardModel({
    threadSurfaces: threadSurfaceData.threadSurfaces,
    runs: threadSurfaceData.runs,
    mergeEvents: threadSurfaceData.mergeEvents,
    runIds: threadSurfaceData.runs.map(run => run.id),
  })

  if (isLoading && !hasRealThreadSurfaceData) return <LoadingSpinner message="Loading sequence..." />
  if (isError && !hasRealThreadSurfaceData) return <div className="flex h-full items-center justify-center text-sm text-destructive">Failed to load sequence status</div>
  if (
    threadSurfaceData.source === 'empty'
    && (!status || (status.steps.length === 0 && status.gates.length === 0))
  ) {
    return <EmptyState />
  }

  if (viewMode === 'hierarchy') {
    return (
      <HierarchyView
        nodes={hierarchyGraph.nodes.map(node => ({
          id: node.id,
          surfaceLabel: node.surfaceLabel,
          depth: node.depth,
          childCount: node.metadata.childCount,
          runStatus: node.metadata.displayRunStatus,
          runSummary: node.metadata.runSummary,
          clickTarget: {
            threadSurfaceId: node.clickTarget.threadSurfaceId,
            runId: node.clickTarget.runId,
          },
        }))}
        selectedThreadSurfaceId={selectedThreadSurfaceId}
        onOpenLane={openLaneViewForThreadSurface}
      />
    )
  }

  return (
    <LaneBoardView
      rows={laneBoard.rows}
      focusedThreadSurfaceId={laneFocusThreadSurfaceId}
      selectedRunId={selectedRunId}
      onFocusThread={(threadSurfaceId, runId) => {
        setLaneFocusThreadSurfaceId(threadSurfaceId)
        setSelectedThreadSurfaceId(threadSurfaceId)
        setSelectedRunId(runId)
      }}
      onBackToHierarchy={() => setViewMode('hierarchy')}
      focusedContent={
        status ? (
          <ReactFlowProvider>
            <div className="h-full">
              <LegacySequenceFlow minimapVisible={minimapVisible} />
            </div>
          </ReactFlowProvider>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Sequence status unavailable for the focused thread.
          </div>
        )
      }
    />
  )
}

export function SequenceCanvas() {
  return (
    <div className="h-full w-full">
      <CanvasInner />
    </div>
  )
}

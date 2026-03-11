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
import { FocusedLanePlane } from '@/components/lanes/FocusedLanePlane'
import { createLaneBoardModel } from '@/components/lanes/useLaneBoard'
import { resolveThreadSurfaceCanvasData } from './threadSurfaceScaffold'
import { resolveThreadSurfaceFocusedDetail } from './threadSurfaceFocus'
import { buildWorkflowLaneContext, contentCreatorWorkflow, resolveWorkflowReferenceStep } from '@/lib/workflows'

const nodeTypes = {
  stepNode: StepNode,
  gateNode: GateNode,
  groupBoundary: GroupBoundary,
  fusionNode: FusionMerge,
}
const edgeTypes = { depEdge: DependencyEdge }

function LegacySequenceFlow({
  minimapVisible,
  status,
  isLoading,
  isError,
}: {
  minimapVisible: boolean
  status: ReturnType<typeof useStatus>['data']
  isLoading: boolean
  isError: boolean
}) {
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
  const selectedNodeId = useUIStore(s => s.selectedNodeId)
  const openLaneViewForThreadSurface = useUIStore(s => s.openLaneViewForThreadSurface)
  const laneBoardState = useUIStore(s => s.laneBoardState)
  const setLaneBoardState = useUIStore(s => s.setLaneBoardState)
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
  const focusedThreadSurfaceId = laneFocusThreadSurfaceId ?? selectedThreadSurfaceId ?? laneBoard.rows[0]?.threadSurfaceId ?? null
  const focusedDetail = resolveThreadSurfaceFocusedDetail({
    threadSurfaces: threadSurfaceData.threadSurfaces,
    runs: threadSurfaceData.runs,
    mergeEvents: threadSurfaceData.mergeEvents,
    rows: laneBoard.rows,
    mergeGroups: laneBoard.mergeGroups,
    focusedThreadSurfaceId,
    selectedRunId,
  })
  const workflowReferenceStep = focusedDetail
    ? resolveWorkflowReferenceStep(contentCreatorWorkflow, {
        selectedNodeId,
        threadSurfaceLabel: focusedDetail.surfaceLabel,
        threadRole: focusedDetail.role,
        runSummary: focusedDetail.runSummary,
      })
    : undefined
  const workflowByThreadSurfaceId: Record<string, ReturnType<typeof buildWorkflowLaneContext>> = {}
  for (const row of laneBoard.rows) {
    const detail = resolveThreadSurfaceFocusedDetail({
      threadSurfaces: threadSurfaceData.threadSurfaces,
      runs: threadSurfaceData.runs,
      mergeEvents: threadSurfaceData.mergeEvents,
      rows: laneBoard.rows,
      mergeGroups: laneBoard.mergeGroups,
      focusedThreadSurfaceId: row.threadSurfaceId,
      selectedRunId: row.runId,
    })

    const workflowStep = resolveWorkflowReferenceStep(contentCreatorWorkflow, {
      threadSurfaceLabel: detail?.surfaceLabel,
      threadRole: detail?.role,
      runSummary: detail?.runSummary,
    })

    if (workflowStep) {
      workflowByThreadSurfaceId[row.threadSurfaceId] = buildWorkflowLaneContext(contentCreatorWorkflow, workflowStep)
    }
  }
  const shouldRenderSequenceFlow = threadSurfaceData.source !== 'api' && status != null

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
          role: node.metadata.role,
          surfaceDescription: node.metadata.surfaceDescription,
          clickTarget: {
            threadSurfaceId: node.clickTarget.threadSurfaceId,
            runId: node.clickTarget.runId,
          },
        }))}
        edges={hierarchyGraph.edges}
        selectedThreadSurfaceId={selectedThreadSurfaceId}
        onSelectThread={(threadSurfaceId, runId) => {
          setSelectedThreadSurfaceId(threadSurfaceId)
          if (runId) setSelectedRunId(runId)
        }}
        onOpenLane={openLaneViewForThreadSurface}
      />
    )
  }

    return (
      <LaneBoardView
      rows={laneBoard.rows}
      focusedThreadSurfaceId={focusedThreadSurfaceId}
      selectedRunId={selectedRunId}
      workflowByThreadSurfaceId={workflowByThreadSurfaceId}
      onFocusThread={(threadSurfaceId, runId) => {
        setLaneBoardState({
          ...laneBoardState,
          focusedThreadSurfaceId: threadSurfaceId,
          focusedRunId: runId,
        })
        setSelectedThreadSurfaceId(threadSurfaceId)
        setSelectedRunId(runId)
      }}
      onBackToHierarchy={() => setViewMode('hierarchy')}
      focusedContent={
        focusedDetail ? (
          <FocusedLanePlane
            detail={focusedDetail}
            workflowStep={workflowReferenceStep}
            sequenceView={shouldRenderSequenceFlow ? (
              <ReactFlowProvider>
                <LegacySequenceFlow
                  minimapVisible={minimapVisible}
                  status={status}
                  isLoading={isLoading}
                  isError={isError}
                />
              </ReactFlowProvider>
            ) : undefined}
          />
        ) : status ? (
          <ReactFlowProvider>
            <div className="h-full">
              <LegacySequenceFlow
                minimapVisible={minimapVisible}
                status={status}
                isLoading={isLoading}
                isError={isError}
              />
            </div>
          </ReactFlowProvider>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
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

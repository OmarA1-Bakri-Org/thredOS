'use client'

import { useCallback, useEffect, useMemo } from 'react'
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
import { CanvasContextMenu, useCanvasContextMenu } from './CanvasContextMenu'
import { NodeDetailCard } from './NodeDetailCard'
import { AgentDetailCard } from './AgentDetailCard'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { EmptyState } from '@/components/EmptyState'
import { LaneBoardView } from '@/components/lanes/LaneBoardView'
import { FocusedLanePlane } from '@/components/lanes/FocusedLanePlane'
import { createLaneBoardModel } from '@/components/lanes/useLaneBoard'
import { resolveThreadSurfaceCanvasData } from './threadSurfaceScaffold'
import { resolveThreadSurfaceFocusedDetail } from './threadSurfaceFocus'
import { buildWorkflowLaneContext, contentCreatorWorkflow, resolveWorkflowReferenceStep } from '@/lib/workflows'
import { PortalTransition } from './PortalTransition'
import { ContextDimOverlay } from './ContextDimOverlay'
import { PathBar } from '@/components/navigation/PathBar'
import { selectCurrentDepthSurfaceId, selectCurrentDepthLevel } from '@/lib/ui/store'
import { useDepthKeyboardNav } from './useDepthKeyboardNav'

const nodeTypes = {
  stepNode: StepNode,
  gateNode: GateNode,
  groupBoundary: GroupBoundary,
  fusionNode: FusionMerge,
}
const edgeTypes = { depEdge: DependencyEdge }

function SequenceFlowGraph({
  minimapVisible,
  status,
  isLoading,
  isError,
  childCountByStepId,
}: {
  minimapVisible: boolean
  status: ReturnType<typeof useStatus>['data']
  isLoading: boolean
  isError: boolean
  childCountByStepId?: Map<string, number>
}) {
  const searchQuery = useUIStore(s => s.searchQuery)
  const { nodes, edges } = useSequenceGraph(status, searchQuery, childCountByStepId)
  const { fitView } = useReactFlow()
  const { menu, openMenu, closeMenu } = useCanvasContextMenu()

  useEffect(() => {
    if (nodes.length > 0) {
      const t = setTimeout(() => fitView({ padding: 0.15 }), 80)
      return () => clearTimeout(t)
    }
  }, [nodes.length, fitView])

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: { id: string }) => {
      event.preventDefault()
      openMenu(event.clientX, event.clientY, node.id)
    },
    [openMenu],
  )

  const onPaneContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      event.preventDefault()
      openMenu((event as React.MouseEvent).clientX, (event as React.MouseEvent).clientY, null)
    },
    [openMenu],
  )

  if (isLoading) return <LoadingSpinner message="Loading sequence..." />
  if (isError) return <div className="flex h-full items-center justify-center text-sm text-destructive">Failed to load sequence status</div>
  if (!status || (status.steps.length === 0 && status.gates.length === 0)) return <EmptyState />

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        className="bg-[#07101b]"
        style={{ background: 'radial-gradient(ellipse at 50% 50%, #0b1420, #060a12)' }}
        onNodeContextMenu={onNodeContextMenu}
        onPaneContextMenu={onPaneContextMenu}
      >
        <Controls className="[&_button]:border-slate-700 [&_button]:bg-[#0a101a] [&_button]:text-slate-300 [&_button]:hover:bg-[#0f1a2e]" />
        <Background color="rgba(255,255,255,0.025)" gap={28} />
        {minimapVisible && (
          <MiniMap
            nodeColor="#1e293b"
            maskColor="rgba(7,16,27,0.85)"
            style={{ background: '#0a101a', border: '1px solid rgba(51,65,85,0.4)' }}
          />
        )}
        <AgentDetailCard />
        <NodeDetailCard />
      </ReactFlow>
      <CanvasContextMenu menu={menu} onClose={closeMenu} />
    </>
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
  const laneBoardState = useUIStore(s => s.laneBoardState)
  const setLaneBoardState = useUIStore(s => s.setLaneBoardState)
  const setSelectedThreadSurfaceId = useUIStore(s => s.setSelectedThreadSurfaceId)
  const setSelectedRunId = useUIStore(s => s.setSelectedRunId)
  const setViewMode = useUIStore(s => s.setViewMode)
  const expandedChildSurfaceIds = useUIStore(s => s.expandedChildSurfaceIds)
  const toggleChildSurfaceExpanded = useUIStore(s => s.toggleChildSurfaceExpanded)
  const currentDepthSurfaceId = useUIStore(selectCurrentDepthSurfaceId)
  const currentDepthLevel = useUIStore(selectCurrentDepthLevel)
  const portalDirection = useUIStore(s => s.portalDirection)
  useDepthKeyboardNav()

  const threadSurfaceData = useMemo(
    () => resolveThreadSurfaceCanvasData({ status, threadSurfaces, runs, mergeEvents }),
    [mergeEvents, runs, status, threadSurfaces],
  )
  const hasRealThreadSurfaceData = threadSurfaceData.source === 'api'

  const laneBoard = createLaneBoardModel({
    threadSurfaces: threadSurfaceData.threadSurfaces,
    runs: threadSurfaceData.runs,
    mergeEvents: threadSurfaceData.mergeEvents,
    runIds: threadSurfaceData.runs.map(run => run.id),
    expandedChildSurfaceIds,
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
  const childCountByStepId = useMemo(() => {
    const map = new Map<string, number>()
    const prefix = 'thread-'
    for (const surface of threadSurfaceData.threadSurfaces) {
      if (surface.childSurfaceIds.length > 0 && surface.id.startsWith(prefix)) {
        const stepId = surface.id.slice(prefix.length)
        map.set(stepId, surface.childSurfaceIds.length)
      }
    }
    return map
  }, [threadSurfaceData.threadSurfaces])

  const shouldRenderSequenceFlow = status != null

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
      <div className="relative h-full w-full overflow-hidden">
        <PortalTransition
          depthKey={currentDepthSurfaceId ?? 'root'}
          direction={portalDirection}
        >
          <ReactFlowProvider>
            <SequenceFlowGraph
              minimapVisible={minimapVisible}
              status={status}
              isLoading={isLoading}
              isError={isError}
              childCountByStepId={childCountByStepId}
            />
          </ReactFlowProvider>
        </PortalTransition>
        <ContextDimOverlay depth={currentDepthLevel} />
        {currentDepthLevel > 0 && (
          <div className="absolute top-3 left-3 z-20">
            <PathBar />
          </div>
        )}
      </div>
    )
  }

  return (
    <LaneBoardView
      rows={laneBoard.rows}
      mergeGroups={laneBoard.mergeGroups}
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
      onToggleCollapse={toggleChildSurfaceExpanded}
      focusedContent={
        focusedDetail ? (
          <FocusedLanePlane
            detail={focusedDetail}
            workflowStep={workflowReferenceStep}
            sequenceView={shouldRenderSequenceFlow ? (
              <ReactFlowProvider>
                <SequenceFlowGraph
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
              <SequenceFlowGraph
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

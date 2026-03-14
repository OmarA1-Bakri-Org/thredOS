'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { ReactFlow, ReactFlowProvider, MiniMap, Controls, Background, useReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useStatus, useThreadMerges, useThreadRuns, useThreadSurfaces, useAgentProfile } from '@/lib/ui/api'
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
import { useHierarchyGraph } from '@/components/hierarchy/useHierarchyGraph'
import { HierarchyView, type HierarchyViewNode } from '@/components/hierarchy/HierarchyView'
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

function SequenceFlowGraph({
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
  const { data: agentProfile } = useAgentProfile(selectedThreadSurfaceId)
  const selectedRunId = useUIStore(s => s.selectedRunId)
  const laneFocusThreadSurfaceId = useUIStore(s => s.laneFocusThreadSurfaceId)
  const selectedNodeId = useUIStore(s => s.selectedNodeId)
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

  useHierarchyGraph({
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
  const shouldRenderSequenceFlow = status != null

  // Build HierarchyViewNodes for the agent cards — must be before early returns
  // to satisfy React's rules of hooks (useMemo must be called unconditionally)
  const hierarchyViewNodes: HierarchyViewNode[] = useMemo(() =>
    threadSurfaceData.threadSurfaces.map(ts => {
      const surfaceRuns = threadSurfaceData.runs.filter(r => r.threadSurfaceId === ts.id)
      const latestRun = surfaceRuns.length > 0
        ? surfaceRuns.reduce((a, b) => (a.startedAt > b.startedAt ? a : b))
        : null

      return {
        id: ts.id,
        surfaceLabel: ts.surfaceLabel,
        depth: ts.depth,
        childCount: ts.childSurfaceIds.length,
        runStatus: latestRun?.runStatus ?? null,
        runSummary: latestRun?.runSummary ?? null,
        role: ts.role ?? null,
        surfaceDescription: ts.surfaceDescription ?? null,
        clickTarget: {
          threadSurfaceId: ts.id,
          runId: latestRun?.id ?? null,
        },
      }
    }),
    [threadSurfaceData.threadSurfaces, threadSurfaceData.runs],
  )

  if (isLoading && !hasRealThreadSurfaceData) return <LoadingSpinner message="Loading sequence..." />
  if (isError && !hasRealThreadSurfaceData) return <div className="flex h-full items-center justify-center text-sm text-destructive">Failed to load sequence status</div>
  if (
    threadSurfaceData.source === 'empty'
    && (!status || (status.steps.length === 0 && status.gates.length === 0))
  ) {
    return <EmptyState />
  }

  const selectedHierarchyNode = hierarchyViewNodes.find(
    n => n.clickTarget.threadSurfaceId === selectedThreadSurfaceId,
  )

  if (viewMode === 'hierarchy') {
    return (
      <div className="flex h-full flex-col">
        <div className={`${selectedHierarchyNode ? 'h-[45%]' : 'h-full'} min-h-0 transition-all duration-300`}>
          <ReactFlowProvider>
            <SequenceFlowGraph
              minimapVisible={minimapVisible}
              status={status}
              isLoading={isLoading}
              isError={isError}
            />
          </ReactFlowProvider>
        </div>
        {selectedHierarchyNode && (
          <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-700/60 bg-[#07101b]">
            <HierarchyView
              nodes={hierarchyViewNodes}
              selectedThreadSurfaceId={selectedThreadSurfaceId}
              profile={agentProfile ?? undefined}
              onSelectThread={(threadSurfaceId, runId) => {
                setSelectedThreadSurfaceId(threadSurfaceId)
                setSelectedRunId(runId)
              }}
              onOpenLane={(threadSurfaceId, runId) => {
                setViewMode('lanes')
                setSelectedThreadSurfaceId(threadSurfaceId)
                setSelectedRunId(runId)
              }}
            />
          </div>
        )}
      </div>
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

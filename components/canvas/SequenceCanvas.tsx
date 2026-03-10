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
import { WorkflowBlueprintPanel } from '@/components/workflows/WorkflowBlueprintPanel'
import { WorkflowStepContextPanel } from '@/components/workflows/WorkflowStepContextPanel'
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
        selectedThreadSurfaceId={selectedThreadSurfaceId}
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
          <div className="flex h-full flex-col overflow-hidden">
            <div className="border-b border-slate-800/80 bg-[#08101d] px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-white">{focusedDetail.surfaceLabel}</h3>
                {focusedDetail.role ? (
                  <span className="rounded-full border border-slate-700 bg-slate-950/65 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-slate-300">
                    {focusedDetail.role}
                  </span>
                ) : null}
                {focusedDetail.runStatus ? (
                  <span className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-emerald-100">
                    {focusedDetail.runStatus}
                  </span>
                ) : null}
              </div>
              {focusedDetail.surfaceDescription ? (
                <p className="mt-2 text-sm text-slate-300">{focusedDetail.surfaceDescription}</p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-400">
                <span>thread {focusedDetail.threadSurfaceId}</span>
                <span>run {focusedDetail.runId ?? 'none'}</span>
                <span>execIndex {focusedDetail.executionIndex ?? 'draft'}</span>
                {focusedDetail.laneTerminalState ? <span>{focusedDetail.laneTerminalState}</span> : null}
                {focusedDetail.mergedIntoThreadSurfaceId ? <span>merged into {focusedDetail.mergedIntoThreadSurfaceId}</span> : null}
              </div>
            </div>
            <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)]">
              <div className="space-y-4">
                {workflowReferenceStep ? (
                  <WorkflowStepContextPanel workflow={contentCreatorWorkflow} step={workflowReferenceStep} />
                ) : (
                  <section className="border border-[#16417C]/70 bg-[#16417C]/18 p-4">
                    <h4 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Execution context</h4>
                    <p className="mt-3 text-sm text-slate-100">{focusedDetail.runSummary ?? 'No workflow step is currently mapped to this lane.'}</p>
                  </section>
                )}
                {shouldRenderSequenceFlow ? (
                  <section className="border border-slate-700 bg-slate-950/65 p-4">
                    <h4 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Sequence view</h4>
                    <div className="mt-3 h-[28rem] overflow-hidden border border-slate-800">
                      <ReactFlowProvider>
                        <LegacySequenceFlow
                          minimapVisible={minimapVisible}
                          status={status}
                          isLoading={isLoading}
                          isError={isError}
                        />
                      </ReactFlowProvider>
                    </div>
                  </section>
                ) : null}
              </div>
              <div className="space-y-4">
                <WorkflowBlueprintPanel workflow={contentCreatorWorkflow} />
                <section className="border border-slate-700 bg-slate-950/65 p-4">
                  <h4 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Incoming Merges</h4>
                  {focusedDetail.incomingMergeGroups.length > 0 ? (
                    <div className="mt-3 space-y-3">
                      {focusedDetail.incomingMergeGroups.map(group => (
                        <div key={group.mergeEventId} className="border border-slate-800 bg-[#0a101a] px-3 py-3 text-sm text-slate-100">
                          <div className="font-medium text-white">
                            {group.mergeKind} merge at execIndex {group.executionIndex}
                          </div>
                          <div className="mt-1 text-slate-400">
                            {group.orderedThreadSurfaceIds.join(' <- ')}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-slate-400">No inbound merges recorded for this thread.</p>
                  )}
                </section>
                <section className="border border-slate-700 bg-slate-950/65 p-4">
                  <h4 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Outgoing Merge Events</h4>
                  {focusedDetail.outgoingMergeEvents.length > 0 ? (
                    <div className="mt-3 space-y-3">
                      {focusedDetail.outgoingMergeEvents.map(event => (
                        <div key={event.id} className="border border-slate-800 bg-[#0a101a] px-3 py-3 text-sm text-slate-100">
                          <div className="font-medium text-white">
                            {event.mergeKind} merge into {event.destinationThreadSurfaceId}
                          </div>
                          <div className="mt-1 text-slate-400">
                            execIndex {event.executionIndex}
                            {event.summary ? ` | ${event.summary}` : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-slate-400">This thread has not merged into another lane.</p>
                  )}
                </section>
              </div>
            </div>
          </div>
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

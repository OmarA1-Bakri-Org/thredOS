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
import { resolveThreadSurfaceFocusedDetail } from './threadSurfaceFocus'

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
            <div className="border-b px-4 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-foreground">{focusedDetail.surfaceLabel}</h3>
                {focusedDetail.role ? (
                  <span className="rounded-full border border-border px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    {focusedDetail.role}
                  </span>
                ) : null}
                {focusedDetail.runStatus ? (
                  <span className="rounded-full border border-border px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    {focusedDetail.runStatus}
                  </span>
                ) : null}
              </div>
              {focusedDetail.surfaceDescription ? (
                <p className="mt-2 text-sm text-muted-foreground">{focusedDetail.surfaceDescription}</p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>thread {focusedDetail.threadSurfaceId}</span>
                <span>run {focusedDetail.runId ?? 'none'}</span>
                <span>execIndex {focusedDetail.executionIndex ?? 'draft'}</span>
                {focusedDetail.laneTerminalState ? <span>{focusedDetail.laneTerminalState}</span> : null}
                {focusedDetail.mergedIntoThreadSurfaceId ? <span>merged into {focusedDetail.mergedIntoThreadSurfaceId}</span> : null}
              </div>
            </div>
            <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
              <div className="space-y-4">
                <section className="rounded-xl border border-border bg-card p-4">
                  <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">Run Summary</h4>
                  <p className="mt-3 text-sm text-foreground">{focusedDetail.runSummary ?? 'No run summary recorded yet.'}</p>
                </section>
                <section className="rounded-xl border border-border bg-card p-4">
                  <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">Run Notes</h4>
                  <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">{focusedDetail.runNotes ?? 'No run notes recorded yet.'}</p>
                </section>
                <section className="rounded-xl border border-border bg-card p-4">
                  <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">AI Discussion</h4>
                  <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">{focusedDetail.runDiscussion ?? 'No discussion recorded for this run yet.'}</p>
                </section>
              </div>
              <div className="space-y-4">
                <section className="rounded-xl border border-border bg-card p-4">
                  <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">Incoming Merges</h4>
                  {focusedDetail.incomingMergeGroups.length > 0 ? (
                    <div className="mt-3 space-y-3">
                      {focusedDetail.incomingMergeGroups.map(group => (
                        <div key={group.mergeEventId} className="rounded-lg border border-border px-3 py-3 text-sm text-foreground">
                          <div className="font-medium">
                            {group.mergeKind} merge at execIndex {group.executionIndex}
                          </div>
                          <div className="mt-1 text-muted-foreground">
                            {group.orderedThreadSurfaceIds.join(' <- ')}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">No inbound merges recorded for this thread.</p>
                  )}
                </section>
                <section className="rounded-xl border border-border bg-card p-4">
                  <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">Outgoing Merge Events</h4>
                  {focusedDetail.outgoingMergeEvents.length > 0 ? (
                    <div className="mt-3 space-y-3">
                      {focusedDetail.outgoingMergeEvents.map(event => (
                        <div key={event.id} className="rounded-lg border border-border px-3 py-3 text-sm text-foreground">
                          <div className="font-medium">
                            {event.mergeKind} merge into {event.destinationThreadSurfaceId}
                          </div>
                          <div className="mt-1 text-muted-foreground">
                            execIndex {event.executionIndex}
                            {event.summary ? ` | ${event.summary}` : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">This thread has not merged into another lane.</p>
                  )}
                </section>
                {shouldRenderSequenceFlow ? (
                  <section className="rounded-xl border border-border bg-card p-4">
                    <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">Current Sequence</h4>
                    <div className="mt-3 h-[28rem] overflow-hidden rounded-lg border border-border">
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

'use client'

import { useMemo } from 'react'
import { projectLaneBoard, type LaneBoardEvent, type LaneBoardRow } from '@/lib/thread-surfaces/projections'
import type { MergeEvent, RunScope, ThreadSurface } from '@/lib/thread-surfaces/types'

export interface LaneBoardModelArgs {
  threadSurfaces: ThreadSurface[]
  runs: RunScope[]
  mergeEvents: MergeEvent[]
  runIds: string[]
  draftSurfaceOrder?: string[]
  expandedChildSurfaceIds?: string[]
}

export interface LaneBoardDisplayRow extends LaneBoardRow {
  isMergeSource: boolean
  parentThreadSurfaceId: string | null
  depth: number
  childCount: number
  isCollapsed: boolean
}

export interface LaneBoardMergeGroup {
  mergeEventId: string
  runId: string
  mergeKind: MergeEvent['mergeKind']
  executionIndex: number
  destinationThreadSurfaceId: string
  orderedThreadSurfaceIds: string[]
}

export interface LaneBoardModel {
  rows: LaneBoardDisplayRow[]
  mergeGroups: LaneBoardMergeGroup[]
}

export function useLaneBoard(args: LaneBoardModelArgs): LaneBoardModel {
  const { threadSurfaces, runs, mergeEvents, runIds, draftSurfaceOrder, expandedChildSurfaceIds } = args
  return useMemo(
    () => createLaneBoardModel({ threadSurfaces, runs, mergeEvents, runIds, draftSurfaceOrder, expandedChildSurfaceIds }),
    [threadSurfaces, runs, mergeEvents, runIds, draftSurfaceOrder, expandedChildSurfaceIds],
  )
}

export function createLaneBoardModel({ threadSurfaces, runs, mergeEvents, runIds, draftSurfaceOrder = [], expandedChildSurfaceIds }: LaneBoardModelArgs): LaneBoardModel {
  const projection = projectLaneBoard({ threadSurfaces, runs, mergeEvents, runIds })
  const projectionOrder = new Map(projection.rows.map((row, index) => [row.threadSurfaceId, index]))
  const draftOrder = new Map(draftSurfaceOrder.map((surfaceId, index) => [surfaceId, index]))
  const mergeEventIdBySignature = new Map(mergeEvents.map(event => [getMergeEventSignature(event), event.id]))

  const sortedRows = projection.rows
    .map<LaneBoardDisplayRow>(row => ({
      ...row,
      isMergeSource: row.laneTerminalState === 'merged',
      parentThreadSurfaceId: null,
      depth: 0,
      childCount: 0,
      isCollapsed: false,
    }))
    .sort((left, right) => compareRows(left, right, projectionOrder, draftOrder))

  // Build parent/child lookup from thread surfaces
  const surfaceById = new Map(threadSurfaces.map(s => [s.id, s]))
  const expandAll = expandedChildSurfaceIds === undefined
  const expandedSet = new Set(expandedChildSurfaceIds ?? [])

  const enrichedRows = sortedRows.map<LaneBoardDisplayRow>(row => {
    const surface = surfaceById.get(row.threadSurfaceId)
    const parentThreadSurfaceId = surface?.parentSurfaceId ?? null
    const depth = surface?.depth ?? 0
    const childCount = threadSurfaces.filter(s => s.parentSurfaceId === row.threadSurfaceId).length
    const isCollapsed = childCount > 0 && !expandAll && !expandedSet.has(row.threadSurfaceId)
    return {
      ...row,
      isMergeSource: row.laneTerminalState === 'merged',
      parentThreadSurfaceId,
      depth,
      childCount,
      isCollapsed,
    }
  })

  // Filter out rows whose parent is collapsed (enforce 2-level inline limit from current view)
  const collapsedSurfaceIds = new Set(enrichedRows.filter(r => r.isCollapsed).map(r => r.threadSurfaceId))
  const visibleRows = enrichedRows.filter(row => {
    if (row.parentThreadSurfaceId == null) return true
    return !collapsedSurfaceIds.has(row.parentThreadSurfaceId)
  })

  const visibleThreadSurfaceIds = new Set(visibleRows.map(row => row.threadSurfaceId))
  const mergeGroups = projection.events
    .flatMap(event => buildMergeGroup(event, visibleThreadSurfaceIds, mergeEventIdBySignature))

  return { rows: visibleRows, mergeGroups }
}

export const buildLaneBoardModel = createLaneBoardModel

function compareRows(
  left: LaneBoardDisplayRow,
  right: LaneBoardDisplayRow,
  projectionOrder: Map<string, number>,
  draftOrder: Map<string, number>,
): number {
  const leftCategory = getRowCategory(left)
  const rightCategory = getRowCategory(right)

  if (leftCategory !== rightCategory) {
    return leftCategory - rightCategory
  }

  if (leftCategory === 0) {
    return compareByProjection(left, right, projectionOrder)
  }

  const leftDraft = draftOrder.get(left.threadSurfaceId)
  const rightDraft = draftOrder.get(right.threadSurfaceId)

  if (leftDraft != null && rightDraft != null) return leftDraft - rightDraft
  if (leftDraft != null) return -1
  if (rightDraft != null) return 1

  return compareByProjection(left, right, projectionOrder)
}

function getRowCategory(row: LaneBoardDisplayRow): 0 | 1 {
  return row.executionIndex != null || row.laneTerminalState === 'merged' ? 0 : 1
}

function compareByProjection(
  left: LaneBoardDisplayRow,
  right: LaneBoardDisplayRow,
  projectionOrder: Map<string, number>,
): number {
  return (projectionOrder.get(left.threadSurfaceId) ?? Number.MAX_SAFE_INTEGER) - (projectionOrder.get(right.threadSurfaceId) ?? Number.MAX_SAFE_INTEGER)
}

function buildMergeGroup(
  event: LaneBoardEvent,
  visibleThreadSurfaceIds: Set<string>,
  mergeEventIdBySignature: Map<string, string>,
): LaneBoardMergeGroup[] {
  if (event.type !== 'merge') return []
  if (!visibleThreadSurfaceIds.has(event.destinationThreadSurfaceId)) return []

  const visibleSourceThreadSurfaceIds = event.sourceThreadSurfaceIds.filter(sourceThreadSurfaceId =>
    visibleThreadSurfaceIds.has(sourceThreadSurfaceId),
  )

  if (visibleSourceThreadSurfaceIds.length === 0) return []

  return [{
    mergeEventId: mergeEventIdBySignature.get(getMergeEventSignature(event)) ?? getMergeEventSignature(event),
    runId: event.runId,
    mergeKind: event.mergeKind,
    executionIndex: event.executionIndex,
    destinationThreadSurfaceId: event.destinationThreadSurfaceId,
    orderedThreadSurfaceIds: [event.destinationThreadSurfaceId, ...visibleSourceThreadSurfaceIds],
  }]
}

function getMergeEventSignature(event: Pick<MergeEvent, 'runId' | 'executionIndex' | 'destinationThreadSurfaceId' | 'mergeKind' | 'sourceThreadSurfaceIds'>): string {
  return [event.runId, event.executionIndex, event.destinationThreadSurfaceId, event.mergeKind, event.sourceThreadSurfaceIds.join('|')].join('::')
}

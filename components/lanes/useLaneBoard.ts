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
}

export interface LaneBoardDisplayRow extends LaneBoardRow {
  isMergeSource: boolean
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
  return useMemo(
    () => createLaneBoardModel(args),
    [args.threadSurfaces, args.runs, args.mergeEvents, args.runIds, args.draftSurfaceOrder],
  )
}

export function createLaneBoardModel({ threadSurfaces, runs, mergeEvents, runIds, draftSurfaceOrder = [] }: LaneBoardModelArgs): LaneBoardModel {
  const projection = projectLaneBoard({ threadSurfaces, runs, mergeEvents, runIds })
  const projectionOrder = new Map(projection.rows.map((row, index) => [row.threadSurfaceId, index]))
  const draftOrder = new Map(draftSurfaceOrder.map((surfaceId, index) => [surfaceId, index]))
  const mergeEventIdBySignature = new Map(mergeEvents.map(event => [getMergeEventSignature(event), event.id]))

  const rows = projection.rows
    .map<LaneBoardDisplayRow>(row => ({
      ...row,
      isMergeSource: row.laneTerminalState === 'merged',
    }))
    .sort((left, right) => compareRows(left, right, projectionOrder, draftOrder))

  const visibleThreadSurfaceIds = new Set(rows.map(row => row.threadSurfaceId))
  const mergeGroups = projection.events
    .flatMap(event => buildMergeGroup(event, visibleThreadSurfaceIds, mergeEventIdBySignature))

  return { rows, mergeGroups }
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

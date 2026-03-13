'use client'

import { useUIStore } from '@/lib/ui/store'
import { useThreadSurfaces, useThreadRuns, useThreadMerges } from '@/lib/ui/api'
import { createLaneBoardModel } from '@/components/lanes/useLaneBoard'
import { resolveThreadSurfaceFocusedDetail } from '@/components/canvas/threadSurfaceFocus'
import { ThreadInspector } from '@/components/inspector/ThreadInspector'
import type { SkillBadge } from '@/components/skills/SkillBadgeRow'

const DEFAULT_SKILLS: SkillBadge[] = [
  { id: 'search', label: 'Search', inherited: false },
  { id: 'files', label: 'Files', inherited: false },
  { id: 'tools', label: 'Tools', inherited: false },
  { id: 'model', label: 'Model', inherited: true },
  { id: 'review', label: 'Review', inherited: true },
]

export function ThreadInspectorContent() {
  const selectedThreadSurfaceId = useUIStore(s => s.selectedThreadSurfaceId)
  const selectedRunId = useUIStore(s => s.selectedRunId)
  const { data: threadSurfaces } = useThreadSurfaces()
  const { data: runs } = useThreadRuns()
  const { data: mergeEvents } = useThreadMerges()

  const laneBoard = threadSurfaces && runs && mergeEvents
    ? createLaneBoardModel({
        threadSurfaces,
        runs,
        mergeEvents,
        runIds: runs.map(run => run.id),
      })
    : null

  const focusedDetail = threadSurfaces && runs && mergeEvents && laneBoard
    ? resolveThreadSurfaceFocusedDetail({
        threadSurfaces,
        runs,
        mergeEvents,
        rows: laneBoard.rows,
        mergeGroups: laneBoard.mergeGroups,
        focusedThreadSurfaceId: selectedThreadSurfaceId,
        selectedRunId,
      })
    : null

  if (!focusedDetail) {
    return <div className="text-sm text-slate-500">Select a thread surface to inspect.</div>
  }

  return <ThreadInspector detail={focusedDetail} skills={DEFAULT_SKILLS} />
}

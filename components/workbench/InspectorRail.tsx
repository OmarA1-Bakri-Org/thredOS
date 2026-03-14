'use client'

import type { ReactNode } from 'react'
import { Layers3, ShieldCheck } from 'lucide-react'
import { useUIStore } from '@/lib/ui/store'

interface InspectorRailProps {
  children: ReactNode
}

export function InspectorRail({ children }: InspectorRailProps) {
  const selectedThreadSurfaceId = useUIStore(s => s.selectedThreadSurfaceId)
  const selectedNodeId = useUIStore(s => s.selectedNodeId)

  const hasThreadContext = !!selectedThreadSurfaceId
  const hasStepContext = !!selectedNodeId

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-800/80 bg-[#050c17] px-4 py-4">
        <div className="flex items-center gap-2">
          {hasStepContext ? (
            <ShieldCheck className="h-4 w-4 text-emerald-300" />
          ) : (
            <Layers3 className="h-4 w-4 text-sky-400" />
          )}
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-slate-500">Inspector</div>
        </div>
        <div className="mt-2 text-base font-semibold tracking-tight text-white">
          {hasStepContext
            ? 'Step / gate detail'
            : hasThreadContext
              ? 'Thread surface'
              : 'Thread / run detail'}
        </div>
        {selectedThreadSurfaceId ? (
          <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">
            {selectedThreadSurfaceId}
          </div>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-4">{children}</div>
    </div>
  )
}

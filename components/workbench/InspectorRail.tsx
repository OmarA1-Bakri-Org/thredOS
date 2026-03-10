'use client'

import type { ReactNode } from 'react'
import { ShieldCheck } from 'lucide-react'

interface InspectorRailProps {
  children: ReactNode
}

export function InspectorRail({ children }: InspectorRailProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-800 px-4 py-4">
        <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Inspector</div>
        <div className="mt-2 flex items-center gap-2 text-lg font-semibold text-white">
          <ShieldCheck className="h-4 w-4 text-emerald-300" />
          Thread / Run detail
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-4">{children}</div>
    </div>
  )
}

'use client'

import { Layers3 } from 'lucide-react'
import { ThreadNavigatorContent } from './ThreadNavigatorContent'
import { SkillsContent } from './SkillsContent'

export function LeftRail() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-800 px-4 py-4">
        <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Navigator</div>
        <div className="mt-2 text-lg font-semibold text-white">Thread surfaces</div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
        <section>
          <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-slate-500">
            <Layers3 className="h-3.5 w-3.5" />
            Thread Navigator
          </div>
          <ThreadNavigatorContent />
        </section>

        <div className="mt-6 border-t border-slate-800 pt-4">
          <SkillsContent />
        </div>
      </div>

    </div>
  )
}

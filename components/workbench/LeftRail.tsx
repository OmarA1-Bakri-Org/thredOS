'use client'

import { Layers3 } from 'lucide-react'
import { ThreadNavigatorContent } from './ThreadNavigatorContent'
import { SkillsContent } from './SkillsContent'

export function LeftRail() {
  return (
    <div className="flex h-full flex-col bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.14),transparent_30%),linear-gradient(180deg,#081326_0%,#050c19_100%)]">
      <div className="border-b border-cyan-300/14 px-4 py-4">
        <div className="text-[11px] uppercase tracking-[0.24em] text-cyan-100/55">Navigator</div>
        <div className="mt-2 text-lg font-semibold text-white">Thread surfaces</div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
        <section className="rounded-[1.25rem] border border-cyan-300/14 bg-cyan-950/10 px-3 py-3 shadow-[inset_0_1px_0_rgba(186,230,253,0.04)]">
          <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-cyan-100/60">
            <Layers3 className="h-3.5 w-3.5" />
            Thread Navigator
          </div>
          <ThreadNavigatorContent />
        </section>

        <div className="mt-6 border-t border-cyan-300/12 pt-4">
          <SkillsContent />
        </div>
      </div>
    </div>
  )
}

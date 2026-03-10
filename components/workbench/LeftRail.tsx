'use client'

import { Layers3, Swords } from 'lucide-react'
import { useThreadSurfaces } from '@/lib/ui/api'
import { useUIStore } from '@/lib/ui/store'

export function LeftRail() {
  const { data: threadSurfaces } = useThreadSurfaces()
  const selectedThreadSurfaceId = useUIStore(s => s.selectedThreadSurfaceId)
  const setSelectedThreadSurfaceId = useUIStore(s => s.setSelectedThreadSurfaceId)

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
          <div className="space-y-2">
            {threadSurfaces && threadSurfaces.length > 0 ? threadSurfaces.map(surface => {
              const selected = selectedThreadSurfaceId === surface.id
              return (
                <button
                  key={surface.id}
                  type="button"
                  onClick={() => setSelectedThreadSurfaceId(surface.id)}
                  className={`flex w-full items-start justify-between border px-3 py-3 text-left transition ${selected ? 'border-sky-500/50 bg-sky-500/8 text-white' : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-600 hover:text-white'}`}
                >
                  <span>
                    <span className="block text-sm font-medium">{surface.surfaceLabel}</span>
                    <span className="mt-1 block text-[11px] uppercase tracking-[0.18em] text-slate-500">depth {surface.depth} · {surface.role ?? 'thread'}</span>
                  </span>
                  <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{surface.childSurfaceIds.length}</span>
                </button>
              )
            }) : (
              <div className="border border-dashed border-slate-800 px-3 py-4 text-sm text-slate-500">No registered thread surfaces yet.</div>
            )}
          </div>
        </section>

      </div>

      <div className="border-t border-slate-800 px-4 py-4">
        <div className="flex items-center justify-between border border-slate-800 bg-slate-950/60 px-3 py-3 text-sm text-slate-300">
          <span className="flex items-center gap-2"><Swords className="h-4 w-4 text-sky-300" />Thread Runner</span>
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-amber-100">Locked</span>
        </div>
      </div>
    </div>
  )
}

'use client'

import { Layers3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
                <Button
                  key={surface.id}
                  type="button"
                  variant={selected ? 'secondary' : 'outline'}
                  size="default"
                  onClick={() => setSelectedThreadSurfaceId(surface.id)}
                  className={`flex h-auto w-full items-start justify-between px-3 py-3 text-left normal-case tracking-normal ${
                    selected ? 'border-sky-500/50 text-white shadow-[0_0_0_1px_rgba(96,165,250,0.15)]' : 'text-slate-300'
                  }`}
                >
                  <span>
                    <span className="block text-sm font-medium">{surface.surfaceLabel}</span>
                    <span className="mt-1 block text-[11px] uppercase tracking-[0.18em] text-slate-500">depth {surface.depth} · {surface.role ?? 'thread'}</span>
                  </span>
                  <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{surface.childSurfaceIds.length}</span>
                </Button>
              )
            }) : (
              <div className="border border-dashed border-slate-800 px-3 py-4 text-sm text-slate-500">No registered thread surfaces yet.</div>
            )}
          </div>
        </section>

      </div>

    </div>
  )
}

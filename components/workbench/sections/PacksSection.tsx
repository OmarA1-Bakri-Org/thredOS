'use client'

import { Package, ChevronUp, Trophy, Shield, Star } from 'lucide-react'
import { useListPacks } from '@/lib/ui/api'
import { PACK_STATUS_PRIORITY } from '@/lib/packs/types'
import type { Pack, PackStatus } from '@/lib/packs/types'

const STATUS_ICON: Record<PackStatus, React.ReactNode> = {
  challenger: <Shield className="h-3.5 w-3.5" />,
  champion: <Trophy className="h-3.5 w-3.5" />,
  hero: <Star className="h-3.5 w-3.5" />,
}

const STATUS_COLOR: Record<PackStatus, string> = {
  challenger: 'text-blue-400 border-blue-500/30 bg-blue-500/10',
  champion: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  hero: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
}

function PackCard({ pack }: { pack: Pack }) {
  return (
    <div
      data-testid={`pack-card-${pack.id}`}
      className="border border-slate-800 bg-[#0a101a] px-4 py-3"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`flex h-6 w-6 items-center justify-center rounded border ${STATUS_COLOR[pack.highestStatus]}`}>
            {STATUS_ICON[pack.highestStatus]}
          </div>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-slate-200">
            {pack.type}
          </span>
        </div>
        <span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] ${STATUS_COLOR[pack.highestStatus]}`}>
          {pack.highestStatus}
        </span>
      </div>
      <div className="mt-2 space-y-1">
        <div className="text-xs text-slate-400">
          <span className="text-slate-600">Division:</span> {pack.division}
        </div>
        <div className="text-xs text-slate-400">
          <span className="text-slate-600">Classification:</span> {pack.classification}
        </div>
        <div className="text-xs text-slate-400">
          <span className="text-slate-600">Builder:</span> {pack.builderName}
        </div>
      </div>
      {pack.statusHistory.length > 0 && (
        <div className="mt-2 border-t border-slate-800/50 pt-2">
          <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-600">
            Progression
          </div>
          <div className="mt-1 flex items-center gap-1">
            {pack.statusHistory.map((entry, i) => (
              <div key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronUp className="h-3 w-3 rotate-90 text-slate-700" />}
                <span className={`rounded border px-1.5 py-0.5 font-mono text-[8px] uppercase ${STATUS_COLOR[entry.status]}`}>
                  {entry.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function PacksSection() {
  const { data: packs, isLoading } = useListPacks()

  const sorted = [...(packs ?? [])].sort(
    (a, b) => PACK_STATUS_PRIORITY[b.highestStatus] - PACK_STATUS_PRIORITY[a.highestStatus]
  )

  return (
    <div data-testid="packs-section" className="space-y-3 px-3 py-3">
      <div className="flex items-center gap-2">
        <Package className="h-4 w-4 text-slate-500" />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
          Packs
        </span>
        {packs && (
          <span className="font-mono text-[9px] text-slate-600">
            ({packs.length})
          </span>
        )}
      </div>

      {isLoading && (
        <div className="text-center text-xs text-slate-600">Loading packs...</div>
      )}

      {!isLoading && sorted.length === 0 && (
        <div className="border border-dashed border-slate-800 px-3 py-4 text-center">
          <div className="text-sm text-slate-500">No packs yet</div>
          <div className="mt-1 text-xs text-slate-600">
            Packs are awarded when agents prove themselves in Thread Runner.
          </div>
        </div>
      )}

      {sorted.map(pack => (
        <PackCard key={pack.id} pack={pack} />
      ))}
    </div>
  )
}

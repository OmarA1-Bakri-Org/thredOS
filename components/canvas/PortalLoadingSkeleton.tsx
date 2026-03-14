'use client'

export function PortalLoadingSkeleton() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#050913]">
      <div className="flex flex-col items-center gap-8">
        {/* Skeleton node blocks arranged like a sequence */}
        <div className="flex items-center gap-4">
          {/* Node 1 */}
          <div className="h-16 w-36 animate-pulse rounded border border-slate-800/60 bg-[#08101d]">
            <div className="flex h-full flex-col justify-center gap-2 px-4">
              <div className="h-2 w-16 rounded bg-slate-700/50" />
              <div className="h-1.5 w-24 rounded bg-slate-800/50" />
            </div>
          </div>

          {/* Connector 1-2 */}
          <div className="h-px w-8 animate-pulse bg-slate-700/40" />

          {/* Node 2 */}
          <div className="h-16 w-36 animate-pulse rounded border border-slate-800/60 bg-[#08101d]" style={{ animationDelay: '150ms' }}>
            <div className="flex h-full flex-col justify-center gap-2 px-4">
              <div className="h-2 w-20 rounded bg-slate-700/50" />
              <div className="h-1.5 w-14 rounded bg-slate-800/50" />
            </div>
          </div>

          {/* Connector 2-3 */}
          <div className="h-px w-8 animate-pulse bg-slate-700/40" />

          {/* Node 3 (gate shape) */}
          <div className="flex h-16 w-16 animate-pulse items-center justify-center" style={{ animationDelay: '300ms' }}>
            <div
              className="h-10 w-10 rounded-sm border border-slate-800/60 bg-[#08101d]"
              style={{ transform: 'rotate(45deg)' }}
            />
          </div>

          {/* Connector 3-4 */}
          <div className="h-px w-8 animate-pulse bg-slate-700/40" />

          {/* Node 4 */}
          <div className="h-16 w-36 animate-pulse rounded border border-slate-800/60 bg-[#08101d]" style={{ animationDelay: '450ms' }}>
            <div className="flex h-full flex-col justify-center gap-2 px-4">
              <div className="h-2 w-12 rounded bg-slate-700/50" />
              <div className="h-1.5 w-20 rounded bg-slate-800/50" />
            </div>
          </div>
        </div>

        {/* Loading text */}
        <p className="font-mono text-[11px] tracking-[0.16em] text-slate-500">
          Loading sequence...
        </p>
      </div>
    </div>
  )
}

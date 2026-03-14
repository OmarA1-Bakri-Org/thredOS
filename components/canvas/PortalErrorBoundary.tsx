'use client'

interface PortalErrorBoundaryProps {
  error: string | null
  surfaceLabel: string
  onReturn: () => void
}

export function PortalErrorBoundary({ error, surfaceLabel, onReturn }: PortalErrorBoundaryProps) {
  if (!error) return null

  return (
    <div className="flex h-full w-full items-center justify-center bg-[#050913]">
      <div className="flex max-w-md flex-col items-center gap-6 rounded border border-slate-800 bg-[#08101d] px-8 py-10 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-rose-500/30 bg-rose-500/10">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-5 w-5 text-rose-400"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z"
              clipRule="evenodd"
            />
          </svg>
        </div>

        <div className="space-y-2">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.22em] text-rose-400">
            Failed to load sequence
          </h3>
          <p className="text-sm text-slate-300">
            Could not load child sequence for <span className="font-semibold text-white">{surfaceLabel}</span>.
          </p>
          <p className="font-mono text-[11px] text-slate-500">{error}</p>
        </div>

        <button
          type="button"
          onClick={onReturn}
          className="rounded border border-slate-700 bg-[#0c1525] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-slate-300 transition-colors hover:border-slate-600 hover:bg-[#0e1a2e] hover:text-white"
        >
          Return to parent
        </button>
      </div>
    </div>
  )
}

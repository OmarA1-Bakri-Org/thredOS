'use client'

export function LoadingSpinner({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-sky-500/45 border-t-transparent" />
        <p className="mt-2 text-sm text-slate-400">{message}</p>
      </div>
    </div>
  )
}

export function LoadingSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className="h-4 animate-pulse rounded bg-slate-800/60"
          style={{ width: `${85 - i * 15}%` }}
        />
      ))}
    </div>
  )
}

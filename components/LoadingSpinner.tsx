'use client'

export function LoadingSpinner({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-sky-500/45 border-t-transparent" />
        <p className="mt-2 text-sm text-slate-500">{message}</p>
      </div>
    </div>
  )
}

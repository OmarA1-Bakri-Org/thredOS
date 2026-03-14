'use client'

import { FileQuestion } from 'lucide-react'

export function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-md text-center">
        <FileQuestion className="mx-auto mb-3 h-12 w-12 text-slate-500" />
        <h2 className="text-lg font-semibold text-white">No Sequence Found</h2>
        <p className="mt-1 text-sm text-slate-400">
          Get started by initializing a new sequence:
        </p>
        <pre className="mt-3 border border-slate-800/90 bg-[#08101d] px-4 py-3 text-sm font-mono text-slate-200">
          thread init my-project
        </pre>
      </div>
    </div>
  )
}

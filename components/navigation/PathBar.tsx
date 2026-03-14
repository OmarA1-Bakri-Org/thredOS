'use client'

import { useUIStore } from '@/lib/ui/store'
import { selectPathSegments } from '@/lib/ui/store'

function ChevronSeparator() {
  return (
    <span className="text-slate-600 mx-0.5 select-none" aria-hidden="true">
      /
    </span>
  )
}

export function PathBar() {
  const pathSegments = useUIStore(selectPathSegments)
  const jumpToDepth = useUIStore((s) => s.jumpToDepth)

  if (pathSegments.length < 2) return null

  const lastIndex = pathSegments.length - 1
  const shouldCollapse = pathSegments.length > 4

  const visibleSegments: Array<{
    segment: { id: string; label: string; depth: number }
    originalIndex: number
  }> = []

  if (shouldCollapse) {
    // First segment
    visibleSegments.push({ segment: pathSegments[0], originalIndex: 0 })
    // Last 2 segments
    visibleSegments.push({
      segment: pathSegments[lastIndex - 1],
      originalIndex: lastIndex - 1,
    })
    visibleSegments.push({
      segment: pathSegments[lastIndex],
      originalIndex: lastIndex,
    })
  } else {
    pathSegments.forEach((segment, index) => {
      visibleSegments.push({ segment, originalIndex: index })
    })
  }

  return (
    <nav
      className="inline-flex items-center bg-slate-900/80 backdrop-blur-sm border border-slate-700/50 rounded px-2 py-1 text-xs font-mono"
      aria-label="Navigation path"
    >
      {visibleSegments.map((entry, i) => {
        const isLast = entry.originalIndex === lastIndex
        const showEllipsisBefore = shouldCollapse && i === 1

        return (
          <span key={entry.segment.id} className="inline-flex items-center">
            {i > 0 && !showEllipsisBefore && <ChevronSeparator />}
            {showEllipsisBefore && (
              <>
                <ChevronSeparator />
                <span className="text-slate-600 mx-0.5 select-none">...</span>
                <ChevronSeparator />
              </>
            )}
            {isLast ? (
              <span
                className="max-w-[120px] truncate text-slate-100"
                title={entry.segment.label}
              >
                {entry.segment.label}
              </span>
            ) : (
              <button
                type="button"
                className="max-w-[120px] truncate text-slate-400 hover:text-slate-200 transition-colors"
                title={entry.segment.label}
                onClick={() => jumpToDepth(entry.originalIndex)}
              >
                {entry.segment.label}
              </button>
            )}
          </span>
        )
      })}
    </nav>
  )
}

import { memo } from 'react'

interface DiffPreviewProps {
  diff: string
}

export const DiffPreview = memo(function DiffPreview({ diff }: DiffPreviewProps) {
  if (!diff) return null

  const lines = diff.split('\n')

  return (
    <div className="my-3 overflow-hidden border border-[#16417C]/70 bg-[#16417C]/14">
      <div className="bg-[#16417C]/18 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-slate-400">
        Preview Changes
      </div>
      <pre className="overflow-x-auto bg-[#08101d] p-3 font-mono text-xs text-slate-200">
        {lines.map((line, i) => {
          let className = ''
          if (line.startsWith('+')) className = 'text-emerald-300'
          else if (line.startsWith('-')) className = 'text-rose-300'
          else if (line.startsWith('@@')) className = 'text-sky-300'
          return (
            <div key={i} className={className}>
              {line}
            </div>
          )
        })}
      </pre>
    </div>
  )
})

'use client'

import { memo, useCallback } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { useUIStore } from '@/lib/ui/store'

export interface FusionMergeData {
  id: string
  name: string
  status: string
  type: string
  model: string
  color: string
  [key: string]: unknown
}

function FusionMergeComponent({ id, data }: NodeProps<Node<FusionMergeData>>) {
  const d = data as FusionMergeData
  const setSelected = useUIStore(s => s.setSelectedNodeId)

  const handleSelect = useCallback(() => setSelected(id), [setSelected, id])
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        handleSelect()
      }
    },
    [handleSelect],
  )

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Fusion synth ${d.name}, status ${d.status}`}
      onClick={handleSelect}
      onKeyDown={handleKeyDown}
      className="cursor-pointer flex items-center justify-center focus:outline-none"
      style={{ width: 200, height: 80 }}
    >
      <Handle type="target" position={Position.Left} className="bg-slate-500! border-slate-700! w-2! h-2!" />
      <div className="relative w-full h-full flex items-center justify-center">
        <svg width="200" height="80" viewBox="0 0 200 80" className="absolute inset-0">
          <polygon
            points="10,0 190,0 160,80 40,80"
            fill="#0a101a"
            stroke={d.color}
            strokeWidth="1.5"
          />
        </svg>
        <div className="relative z-10 text-center px-4">
          <div className="flex items-center justify-center gap-1.5">
            <span className="font-mono text-[10px] tracking-wide text-slate-500">{d.id}</span>
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: d.color }}
            />
            <span
              className="font-mono text-[8px] uppercase tracking-[0.12em]"
              style={{ color: d.color }}
            >
              {d.status}
            </span>
          </div>
          <div className="text-xs font-semibold tracking-tight text-slate-100 truncate">{d.name}</div>
          <div className="flex gap-1 justify-center mt-0.5">
            <span className="px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.1em] border border-amber-500/30 bg-amber-500/10 text-amber-400">
              synth
            </span>
            <span className="px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.1em] border border-slate-700/60 bg-slate-800/40 text-slate-400">
              {d.model}
            </span>
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="bg-slate-500! border-slate-700! w-2! h-2!" />
    </div>
  )
}

export const FusionMerge = memo(FusionMergeComponent)

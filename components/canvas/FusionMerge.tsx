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
  const selectedNodeId = useUIStore(s => s.selectedNodeId)
  const setSelected = useUIStore(s => s.setSelectedNodeId)
  const isSelected = selectedNodeId === id

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
      style={{ width: 220, height: 80 }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{
          width: 8,
          height: 8,
          background: isSelected ? d.color : '#475569',
          border: `1.5px solid ${isSelected ? d.color : '#334155'}`,
          boxShadow: isSelected ? `0 0 6px ${d.color}50` : 'none',
        }}
      />
      <div className="relative w-full h-full flex items-center justify-center">
        <svg width="220" height="80" viewBox="0 0 220 80" className="absolute inset-0">
          <defs>
            <linearGradient id={`fg-${id}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={d.color} stopOpacity="0.1" />
              <stop offset="100%" stopColor="#0a101a" stopOpacity="1" />
            </linearGradient>
          </defs>
          <polygon
            points="14,2 206,2 180,78 40,78"
            fill={`url(#fg-${id})`}
            stroke={d.color}
            strokeWidth={isSelected ? 1.5 : 1}
            strokeOpacity={isSelected ? 0.7 : 0.35}
          />
        </svg>
        <div className="relative z-10 text-center px-6">
          <div className="text-[13px] font-semibold tracking-tight text-slate-100 truncate">{d.name}</div>
          <div className="mt-0.5 flex items-center justify-center gap-1.5">
            <span className="font-mono text-[10px] tracking-wide text-slate-500/70">{d.id}</span>
            <span
              className="h-[5px] w-[5px] rounded-full"
              style={{ background: d.color, boxShadow: `0 0 6px ${d.color}80` }}
            />
            <span
              className="font-mono text-[8px] uppercase tracking-[0.12em]"
              style={{ color: d.color }}
            >
              {d.status}
            </span>
          </div>
          <div className="mt-1.5 flex gap-1 justify-center">
            <span className="px-1.5 py-[1px] font-mono text-[9px] uppercase tracking-[0.1em] leading-tight border border-amber-500/25 bg-amber-500/8 text-amber-400">
              synth
            </span>
            <span className="px-1.5 py-[1px] font-mono text-[9px] uppercase tracking-[0.1em] leading-tight border border-slate-700/40 bg-slate-800/20 text-slate-500">
              {d.model}
            </span>
          </div>
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        style={{
          width: 8,
          height: 8,
          background: isSelected ? d.color : '#475569',
          border: `1.5px solid ${isSelected ? d.color : '#334155'}`,
          boxShadow: isSelected ? `0 0 6px ${d.color}50` : 'none',
        }}
      />
    </div>
  )
}

export const FusionMerge = memo(FusionMergeComponent)

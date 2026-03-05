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
    [handleSelect]
  )

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Fusion synth ${d.name}, status ${d.status}`}
      onClick={handleSelect}
      onKeyDown={handleKeyDown}
      className="cursor-pointer flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      style={{ width: 200, height: 80 }}
    >
      <Handle type="target" position={Position.Left} />
      <div className="relative w-full h-full flex items-center justify-center">
        {/* Funnel/merge shape via CSS */}
        <svg width="200" height="80" viewBox="0 0 200 80" className="absolute inset-0">
          <polygon
            points="10,0 190,0 160,80 40,80"
            fill="hsl(var(--card))"
            stroke={d.color}
            strokeWidth="2"
          />
        </svg>
        <div className="relative z-10 text-center px-4">
          <div className="flex items-center justify-center gap-1">
            <span className="text-[10px] font-mono text-muted-foreground">{d.id}</span>
            <span className="text-[9px] px-1 rounded" style={{ background: d.color, color: '#fff' }}>{d.status}</span>
          </div>
          <div className="text-xs font-medium truncate">{d.name}</div>
          <div className="flex gap-1 justify-center mt-0.5">
            <span className="text-[9px] bg-muted px-1 rounded">synth</span>
            <span className="text-[9px] bg-muted px-1 rounded">{d.model}</span>
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export const FusionMerge = memo(FusionMergeComponent)

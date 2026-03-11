'use client'

import { memo, useCallback } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { useUIStore } from '@/lib/ui/store'

export interface GateNodeData {
  id: string
  name: string
  status: string
  color: string
  [key: string]: unknown
}

function GateNodeComponent({ id, data }: NodeProps<Node<GateNodeData>>) {
  const d = data as GateNodeData
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
      aria-label={`Gate ${d.name}, status ${d.status}`}
      onClick={handleSelect}
      onKeyDown={handleKeyDown}
      className="cursor-pointer flex items-center justify-center focus:outline-none"
      style={{ width: 80, height: 80 }}
    >
      <Handle type="target" position={Position.Left} className="bg-slate-500! border-slate-700! w-2! h-2!" />
      <div
        className="flex flex-col items-center justify-center transition-shadow hover:shadow-lg"
        style={{
          width: 56,
          height: 56,
          background: '#0a101a',
          border: `2px solid ${d.color}`,
          transform: 'rotate(45deg)',
          boxShadow: `0 0 8px ${d.color}22`,
        }}
      >
        <div style={{ transform: 'rotate(-45deg)' }} className="text-center">
          <div className="font-mono text-[9px] tracking-wide text-slate-400">{d.id}</div>
          <div
            className="font-mono text-[8px] uppercase tracking-[0.1em]"
            style={{ color: d.color }}
          >
            {d.status}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="bg-slate-500! border-slate-700! w-2! h-2!" />
    </div>
  )
}

export const GateNode = memo(GateNodeComponent)

'use client'

import { memo, useCallback } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { useUIStore } from '@/lib/ui/store'

export interface GateNodeData {
  id: string
  name: string
  status: string
  color: string
  phaseId: string | null
  [key: string]: unknown
}

function GateNodeComponent({ id, data }: NodeProps<Node<GateNodeData>>) {
  const d = data as GateNodeData
  const selectedNodeId = useUIStore(s => s.selectedNodeId)
  const setSelected = useUIStore(s => s.setSelectedNodeId)
  const selectedPhaseId = useUIStore(s => s.selectedPhaseId)
  const isSelected = selectedNodeId === id
  const isPhaseHighlighted = !!selectedPhaseId && d.phaseId === selectedPhaseId

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
      style={{ width: 96, height: 96 }}
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
      <div
        className="flex flex-col items-center justify-center transition-all duration-200"
        style={{
          width: 64,
          height: 64,
          background: `linear-gradient(135deg, ${d.color}10, #0a101a 70%)`,
          border: `1.5px solid ${isSelected ? d.color + 'bb' : isPhaseHighlighted ? 'rgba(52,211,153,0.5)' : d.color + '60'}`,
          transform: 'rotate(45deg)',
          boxShadow: isSelected
            ? `0 0 28px ${d.color}25, inset 0 0 18px ${d.color}0a`
            : isPhaseHighlighted
            ? '0 0 16px rgba(52,211,153,0.12), 0 0 4px rgba(52,211,153,0.08)'
            : `0 0 12px ${d.color}10`,
        }}
      >
        <div style={{ transform: 'rotate(-45deg)' }} className="text-center px-0.5">
          <div className="font-mono text-[9px] leading-tight tracking-wide text-slate-300 truncate max-w-[58px]">
            {d.id}
          </div>
          <div
            className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.12em] font-medium"
            style={{ color: d.color }}
          >
            {d.status}
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

export const GateNode = memo(GateNodeComponent)

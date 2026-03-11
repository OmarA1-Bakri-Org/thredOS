'use client'

import { memo, useCallback } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { useUIStore } from '@/lib/ui/store'

const TYPE_COLORS: Record<string, string> = {
  base: '#64748b',
  p: '#818cf8',
  c: '#38bdf8',
  f: '#fbbf24',
  b: '#a78bfa',
  l: '#34d399',
}

export interface StepNodeData {
  id: string
  name: string
  status: string
  type: string
  model: string
  color: string
  [key: string]: unknown
}

function StepNodeComponent({ id, data }: NodeProps<Node<StepNodeData>>) {
  const d = data as StepNodeData
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

  const typeColor = TYPE_COLORS[d.type] || '#64748b'

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Step ${d.name}, status ${d.status}`}
      onClick={handleSelect}
      onKeyDown={handleKeyDown}
      className="cursor-pointer transition-all duration-150"
      style={{ minWidth: 180 }}
    >
      <Handle type="target" position={Position.Left} className="bg-slate-500! border-slate-700! w-2! h-2!" />
      <div
        className="relative overflow-hidden border"
        style={{
          background: isSelected ? '#0f1a2e' : '#0a101a',
          borderColor: isSelected ? d.color : 'rgba(51,65,85,0.6)',
          boxShadow: isSelected ? `0 0 12px ${d.color}33` : 'none',
        }}
      >
        <div
          className="absolute left-0 top-0 bottom-0 w-[3px]"
          style={{ background: d.color }}
        />
        <div className="pl-3.5 pr-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] tracking-wide text-slate-500">{d.id}</span>
            <div className="flex items-center gap-1">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: d.color }}
              />
              <span
                className="font-mono text-[9px] uppercase tracking-[0.12em]"
                style={{ color: d.color }}
              >
                {d.status}
              </span>
            </div>
          </div>
          <div className="mt-1 text-sm font-semibold tracking-tight text-slate-100 truncate">{d.name}</div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <span
              className="px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.1em]"
              style={{
                background: `${typeColor}18`,
                color: typeColor,
                border: `1px solid ${typeColor}40`,
              }}
            >
              {d.type}
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

export const StepNode = memo(StepNodeComponent)

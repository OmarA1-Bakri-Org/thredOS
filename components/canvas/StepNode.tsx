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
  phaseId: string | null
  childCount: number
  [key: string]: unknown
}

function StepNodeComponent({ id, data }: NodeProps<Node<StepNodeData>>) {
  const d = data as StepNodeData
  const selectedNodeId = useUIStore(s => s.selectedNodeId)
  const setSelected = useUIStore(s => s.setSelectedNodeId)
  const selectedPhaseId = useUIStore(s => s.selectedPhaseId)
  const isSelected = selectedNodeId === id
  const isRunning = d.status === 'RUNNING'
  const isPhaseHighlighted = !!selectedPhaseId && d.phaseId === selectedPhaseId

  const pushDepth = useUIStore(s => s.pushDepth)

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

  const handleDoubleClick = useCallback(() => {
    if (d.childCount > 0) {
      pushDepth({
        threadSurfaceId: `thread-${id}`,
        surfaceLabel: d.name,
        depth: 1, // will be resolved by the caller
      })
    }
  }, [d.childCount, d.name, id, pushDepth])

  const typeColor = TYPE_COLORS[d.type] || '#64748b'
  const cornerColor = isSelected ? d.color : 'rgba(148,163,184,0.18)'

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Step ${d.name}, status ${d.status}`}
      onClick={handleSelect}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      className="cursor-pointer group"
      style={{ width: 220 }}
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
        className="relative overflow-hidden transition-all duration-200"
        style={{
          background: `linear-gradient(145deg, ${d.color}0a 0%, #0a101a 45%)`,
          border: `1px solid ${isSelected ? d.color + '70' : isPhaseHighlighted ? 'rgba(52,211,153,0.5)' : 'rgba(51,65,85,0.45)'}`,
          boxShadow: isSelected
            ? `0 0 24px ${d.color}1a, inset 0 1px 30px ${d.color}08`
            : isPhaseHighlighted
            ? '0 0 16px rgba(52,211,153,0.12), 0 0 4px rgba(52,211,153,0.08)'
            : isRunning
            ? `0 0 16px ${d.color}12`
            : '0 2px 10px rgba(0,0,0,0.35)',
        }}
      >
        {/* Top accent bar */}
        <div
          className="h-[2px] w-full"
          style={{ background: `linear-gradient(90deg, ${d.color}cc, ${d.color}15)` }}
        />

        {/* Corner accents — HUD targeting brackets */}
        <div className="absolute top-0 left-0 w-2.5 h-2.5 border-t-[1.5px] border-l-[1.5px] transition-colors duration-200" style={{ borderColor: cornerColor }} />
        <div className="absolute top-0 right-0 w-2.5 h-2.5 border-t-[1.5px] border-r-[1.5px] transition-colors duration-200" style={{ borderColor: cornerColor }} />
        <div className="absolute bottom-0 left-0 w-2.5 h-2.5 border-b-[1.5px] border-l-[1.5px] transition-colors duration-200" style={{ borderColor: cornerColor }} />
        <div className="absolute bottom-0 right-0 w-2.5 h-2.5 border-b-[1.5px] border-r-[1.5px] transition-colors duration-200" style={{ borderColor: cornerColor }} />

        {/* Thread type indicator — left edge */}
        <div
          className="absolute left-0 top-[2px] bottom-0 w-[2px]"
          style={{ background: `linear-gradient(180deg, ${typeColor}, ${typeColor}30)` }}
        />

        <div className="px-3 py-2.5 pl-3.5">
          {/* Row 1: Name + Status */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-semibold tracking-tight text-slate-100 truncate leading-tight">
              {d.name}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <span
                className={`h-[6px] w-[6px] rounded-full shrink-0 ${isRunning ? 'animate-pulse' : ''}`}
                style={{ background: d.color, boxShadow: `0 0 6px ${d.color}80` }}
              />
              <span
                className="font-mono text-[9px] uppercase tracking-[0.14em] leading-none"
                style={{ color: d.color }}
              >
                {d.status}
              </span>
            </div>
          </div>

          {/* Row 2: Step ID */}
          <div className="mt-0.5 font-mono text-[10px] tracking-wide text-slate-500/70 leading-none">
            {d.id}
          </div>

          {/* Row 3: Type + Model badges */}
          <div className="mt-2 flex items-center gap-1.5">
            <span
              className="px-1.5 py-[1px] font-mono text-[9px] uppercase tracking-[0.1em] leading-tight"
              style={{
                background: `${typeColor}14`,
                color: typeColor,
                border: `1px solid ${typeColor}30`,
              }}
            >
              {d.type}
            </span>
            <span className="px-1.5 py-[1px] font-mono text-[9px] uppercase tracking-[0.1em] leading-tight border border-slate-700/40 bg-slate-800/25 text-slate-500">
              {d.model}
            </span>
          </div>

          {/* Row 4: Child count depth indicator */}
          {d.childCount > 0 && (
            <div className="mt-1.5 flex items-center gap-1">
              <span
                className="inline-flex items-center gap-0.5 px-1.5 py-[1px] font-mono text-[9px] tracking-[0.1em] leading-tight border border-emerald-600/30 bg-emerald-900/15 text-emerald-400 cursor-pointer"
                title={`${d.childCount} child thread${d.childCount > 1 ? 's' : ''} — double-click to drill in`}
              >
                <span className="text-[8px]">▼</span>
                {d.childCount}
              </span>
            </div>
          )}
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

export const StepNode = memo(StepNodeComponent)

'use client'

import { useCallback } from 'react'
import { useReactFlow, useStore as useFlowStore } from '@xyflow/react'
import { X, Play, Square, RotateCcw, Copy, Trash2, Pencil } from 'lucide-react'
import { useUIStore } from '@/lib/ui/store'
import { useStatus, useRunStep, useStopStep, useRestartStep } from '@/lib/ui/api'

const TYPE_COLORS: Record<string, string> = {
  base: '#64748b',
  p: '#818cf8',
  c: '#38bdf8',
  f: '#fbbf24',
  b: '#a78bfa',
  l: '#34d399',
}

const STATUS_COLORS: Record<string, string> = {
  READY: '#64748b',
  RUNNING: '#38bdf8',
  NEEDS_REVIEW: '#fbbf24',
  DONE: '#34d399',
  FAILED: '#ef4444',
  BLOCKED: '#f97316',
  PENDING: '#64748b',
  APPROVED: '#34d399',
}

/**
 * Agent detail card that renders ON the canvas in flow coordinates.
 * Positioned to the right of the selected node, zooms/pans with the canvas.
 */
export function NodeDetailCard() {
  const selectedNodeId = useUIStore(s => s.selectedNodeId)
  const setSelectedNodeId = useUIStore(s => s.setSelectedNodeId)
  const { data: status } = useStatus()
  const runStep = useRunStep()
  const stopStep = useStopStep()
  const restartStep = useRestartStep()

  const { getNode } = useReactFlow()

  // Read the viewport transform from React Flow's internal store
  const transform = useFlowStore(s => s.transform) // [x, y, zoom]

  const dismiss = useCallback(() => setSelectedNodeId(null), [setSelectedNodeId])

  if (!selectedNodeId || !status) return null

  const flowNode = getNode(selectedNodeId)
  if (!flowNode) return null

  const step = status.steps.find(s => s.id === selectedNodeId)
  const gate = status.gates.find(g => g.id === selectedNodeId)
  if (!step && !gate) return null

  // Position card to the right of the node, in flow coordinates
  const nodeWidth = flowNode.measured?.width ?? (flowNode.type === 'gateNode' ? 96 : 220)
  const cardX = (flowNode.position.x + nodeWidth + 24) * transform[2] + transform[0]
  const cardY = flowNode.position.y * transform[2] + transform[1]

  const isStep = !!step
  const nodeData = step ?? gate!
  const statusColor = STATUS_COLORS[nodeData.status] ?? '#64748b'
  const typeColor = isStep ? (TYPE_COLORS[step!.type] ?? '#64748b') : '#34d399'

  return (
    <div
      className="pointer-events-auto absolute"
      style={{
        left: cardX,
        top: cardY,
        zIndex: 1000,
        transformOrigin: 'top left',
        transform: `scale(${transform[2]})`,
      }}
      // Prevent canvas pan when interacting with the card
      onPointerDown={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
    >
      <div
        className="w-[280px] overflow-hidden border border-slate-700/60 bg-[#0a1220]/95 shadow-2xl shadow-black/50 backdrop-blur-sm"
        style={{ borderTopColor: statusColor + '80' }}
      >
        {/* Status accent bar */}
        <div className="h-[2px]" style={{ background: `linear-gradient(90deg, ${statusColor}, ${statusColor}20)` }} />

        {/* Header */}
        <div className="flex items-center gap-2 border-b border-slate-700/40 px-3 py-2">
          <div
            className="h-2 w-2 rounded-full shrink-0"
            style={{ background: statusColor, boxShadow: `0 0 8px ${statusColor}60` }}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-white">{nodeData.name ?? nodeData.id}</div>
            <div className="font-mono text-[9px] tracking-wide text-slate-500">{nodeData.id}</div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="shrink-0 rounded p-1 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
            aria-label="Close agent card"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Agent stats grid */}
        <div className="grid grid-cols-3 gap-px bg-slate-700/20">
          {/* Status */}
          <div className="bg-[#0a1220] px-3 py-2">
            <div className="font-mono text-[8px] uppercase tracking-[0.2em] text-slate-600">Status</div>
            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: statusColor }}>
              {nodeData.status}
            </div>
          </div>

          {/* Type */}
          <div className="bg-[#0a1220] px-3 py-2">
            <div className="font-mono text-[8px] uppercase tracking-[0.2em] text-slate-600">Type</div>
            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: typeColor }}>
              {isStep ? step!.type : 'gate'}
            </div>
          </div>

          {/* Model */}
          <div className="bg-[#0a1220] px-3 py-2">
            <div className="font-mono text-[8px] uppercase tracking-[0.2em] text-slate-600">Model</div>
            <div className="mt-0.5 truncate font-mono text-[10px] tracking-[0.08em] text-slate-300">
              {isStep ? step!.model : '—'}
            </div>
          </div>
        </div>

        {/* Dependencies */}
        {isStep && step!.dependsOn.length > 0 && (
          <div className="border-t border-slate-700/30 px-3 py-2">
            <div className="font-mono text-[8px] uppercase tracking-[0.2em] text-slate-600">Dependencies</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {step!.dependsOn.map((dep: string) => (
                <span key={dep} className="border border-amber-500/25 bg-amber-500/8 px-1.5 py-0.5 font-mono text-[9px] text-amber-200/80">
                  {dep}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1 border-t border-slate-700/40 px-3 py-2">
          {isStep && (
            <>
              <button
                type="button"
                onClick={() => runStep.mutate({ stepId: selectedNodeId })}
                disabled={runStep.isPending}
                className="flex items-center gap-1 rounded px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-emerald-300 transition-all hover:bg-emerald-500/15"
                title="Run step"
              >
                <Play className="h-3 w-3" />
                Run
              </button>
              <button
                type="button"
                onClick={() => stopStep.mutate({ stepId: selectedNodeId })}
                disabled={stopStep.isPending}
                className="flex items-center gap-1 rounded px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-rose-300 transition-all hover:bg-rose-500/15"
                title="Stop step"
              >
                <Square className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => restartStep.mutate({ stepId: selectedNodeId })}
                disabled={restartStep.isPending}
                className="flex items-center gap-1 rounded px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-sky-300 transition-all hover:bg-sky-500/15"
                title="Restart step"
              >
                <RotateCcw className="h-3 w-3" />
              </button>
            </>
          )}
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
              title="Edit agent"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              type="button"
              className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
              title="Clone agent"
            >
              <Copy className="h-3 w-3" />
            </button>
            <button
              type="button"
              className="rounded p-1 text-slate-500 transition-colors hover:bg-rose-900/30 hover:text-rose-300"
              title="Delete"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

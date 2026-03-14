'use client'

import { useCallback, useMemo, useState } from 'react'
import { useReactFlow, useStore as useFlowStore } from '@xyflow/react'
import { X, Play, Square, RotateCcw, Copy, Trash2, Check, Ban } from 'lucide-react'
import { useUIStore } from '@/lib/ui/store'
import { useStatus, useRunStep, useStopStep, useRestartStep, useApproveGate, useBlockGate, useRemoveStep, useRemoveGate, useCloneStep } from '@/lib/ui/api'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

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

/* ── Stat bar — 10-segment rubric bar matching FocusedThreadCard ──── */

function DepCompletionBar({ done, total }: { done: number; total: number }) {
  const filled = Math.round((done / total) * 10)
  return (
    <div className="grid grid-cols-10 gap-0.5">
      {Array.from({ length: 10 }, (_, i) => (
        <div
          key={i}
          className={`h-1.5 border ${
            i < filled
              ? 'border-emerald-400/25 bg-emerald-400/60'
              : 'border-slate-900 bg-slate-900/80'
          }`}
        />
      ))}
    </div>
  )
}

/**
 * Trading-card-style agent detail card rendered ON the canvas.
 * Positioned to the right of the selected node, zooms/pans with the viewport.
 *
 * Visual language adapted from FocusedThreadCard (badges, score boxes, stat
 * bars, bordered sections) and StepNode (HUD corner brackets, accent bar,
 * left-edge type indicator, status dot with glow/pulse).
 */
export function NodeDetailCard() {
  const selectedNodeId = useUIStore(s => s.selectedNodeId)
  const setSelectedNodeId = useUIStore(s => s.setSelectedNodeId)
  const { data: status } = useStatus()
  const runStep = useRunStep()
  const stopStep = useStopStep()
  const restartStep = useRestartStep()
  const approveGate = useApproveGate()
  const blockGate = useBlockGate()
  const removeStep = useRemoveStep()
  const removeGate = useRemoveGate()
  const cloneStep = useCloneStep()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const { getNode } = useReactFlow()
  const transform = useFlowStore(s => s.transform) // [x, y, zoom]

  const dismiss = useCallback(() => setSelectedNodeId(null), [setSelectedNodeId])

  // Compute dependency completion for the stat bar
  const depCompletion = useMemo(() => {
    if (!selectedNodeId || !status) return null
    const step = status.steps.find(s => s.id === selectedNodeId)
    if (!step || !step.dependsOn.length) return null
    const total = step.dependsOn.length
    const done = step.dependsOn.filter(depId => {
      const d = status.steps.find(s => s.id === depId) ?? status.gates.find(g => g.id === depId)
      return d?.status === 'DONE' || d?.status === 'APPROVED'
    }).length
    return { done, total }
  }, [selectedNodeId, status])

  if (!selectedNodeId || !status) return null

  const flowNode = getNode(selectedNodeId)
  if (!flowNode) return null

  const step = status.steps.find(s => s.id === selectedNodeId)
  const gate = status.gates.find(g => g.id === selectedNodeId)
  if (!step && !gate) return null

  // ── Derived values ─────────────────────────────────────────────────
  const nodeWidth = flowNode.measured?.width ?? (flowNode.type === 'gateNode' ? 96 : 220)
  const nodeHeight = flowNode.measured?.height ?? (flowNode.type === 'gateNode' ? 96 : 68)
  const zoom = transform[2]
  const tx = transform[0]
  const ty = transform[1]
  // Center card horizontally under the node, 16 canvas-px below
  const cardHalfW = 160 // half of 320px card width
  const cardX = (flowNode.position.x + nodeWidth / 2 - cardHalfW) * zoom + tx
  const cardY = (flowNode.position.y + nodeHeight + 16) * zoom + ty

  const isStep = !!step
  const isGate = !!gate
  const nodeData = step ?? gate!
  const isRunning = nodeData.status === 'RUNNING'
  const statusColor = STATUS_COLORS[nodeData.status] ?? '#64748b'
  const typeColor = isStep ? (TYPE_COLORS[step!.type] ?? '#64748b') : '#34d399'
  // Use the node's accent color for HUD brackets (set by SequenceCanvas)
  const accentColor = (flowNode.data as Record<string, unknown>)?.color as string | undefined ?? statusColor
  const deps = isStep ? step!.dependsOn : gate!.dependsOn
  const depCount = deps.length

  return (
    <div
      className="pointer-events-auto absolute"
      style={{
        left: cardX,
        top: cardY,
        zIndex: 1000,
        transformOrigin: 'top left',
        transform: `scale(${zoom})`,
      }}
      onPointerDown={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
    >
      <article
        data-testid="node-detail-card"
        className="relative w-[320px] overflow-hidden border border-slate-700/80 bg-[#0a101a] shadow-[0_28px_80px_rgba(0,0,0,0.54)]"
      >
        {/* ── HUD corner brackets (from StepNode) ──────────────────── */}
        <div className="absolute top-0 left-0 w-3 h-3 border-t-[1.5px] border-l-[1.5px] transition-colors duration-200" style={{ borderColor: accentColor }} />
        <div className="absolute top-0 right-0 w-3 h-3 border-t-[1.5px] border-r-[1.5px] transition-colors duration-200" style={{ borderColor: accentColor }} />
        <div className="absolute bottom-0 left-0 w-3 h-3 border-b-[1.5px] border-l-[1.5px] transition-colors duration-200" style={{ borderColor: accentColor }} />
        <div className="absolute bottom-0 right-0 w-3 h-3 border-b-[1.5px] border-r-[1.5px] transition-colors duration-200" style={{ borderColor: accentColor }} />

        {/* ── Top accent gradient bar ──────────────────────────────── */}
        <div
          className="h-[2px] w-full"
          style={{ background: `linear-gradient(90deg, ${accentColor}cc, ${accentColor}15)` }}
        />

        {/* ── Left edge type indicator ─────────────────────────────── */}
        <div
          className="absolute left-0 top-[2px] bottom-0 w-[2px]"
          style={{ background: `linear-gradient(180deg, ${typeColor}, ${typeColor}30)` }}
        />

        {/* ── Badge row (FocusedThreadCard style) ──────────────────── */}
        <div className="flex items-center gap-2 border-b border-slate-800/80 px-4 pt-3 pb-2.5">
          <div className="flex flex-wrap gap-1.5 flex-1">
            <span
              className="rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.2em]"
              style={{
                borderColor: `${typeColor}40`,
                background: `${typeColor}08`,
                color: typeColor,
              }}
            >
              {isStep ? step!.type : 'gate'}
            </span>
            <span
              className="rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.2em]"
              style={{
                borderColor: `${statusColor}40`,
                background: `${statusColor}08`,
                color: statusColor,
              }}
            >
              {nodeData.status}
            </span>
            {isStep && (
              <span className="rounded-full border border-slate-600/40 bg-slate-600/8 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.2em] text-slate-400">
                {step!.model}
              </span>
            )}
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

        {/* ── Agent name + ID ──────────────────────────────────────── */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span
              className={`h-[7px] w-[7px] rounded-full shrink-0 ${isRunning ? 'animate-pulse' : ''}`}
              style={{ background: statusColor, boxShadow: `0 0 8px ${statusColor}60` }}
            />
            <h3 className="text-lg font-semibold tracking-tight text-white truncate leading-tight">
              {nodeData.name ?? nodeData.id}
            </h3>
          </div>
          <div className="mt-0.5 pl-[19px] font-mono text-[10px] tracking-wide text-slate-500/70 leading-none">
            {nodeData.id}
          </div>
        </div>

        {/* ── Score boxes (FocusedThreadCard Thread Power / Weight style) */}
        <div className="grid grid-cols-2 gap-3 px-4 pb-3">
          <div className="border border-slate-700 bg-slate-900/80 px-3 py-2.5">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Status</div>
            <div className="mt-1 text-xl font-semibold" style={{ color: statusColor }}>
              {nodeData.status === 'NEEDS_REVIEW' ? 'REVIEW' : nodeData.status}
            </div>
            <div className="mt-0.5 text-[10px] text-slate-400">
              {isStep ? `${step!.type} thread` : 'gate checkpoint'}
            </div>
          </div>
          <div className="border border-slate-700 bg-slate-900/80 px-3 py-2.5">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Upstream</div>
            <div className="mt-1 text-xl font-semibold text-white">{depCount}</div>
            <div className="mt-0.5 text-[10px] text-slate-400">
              {depCompletion
                ? `${depCompletion.done}/${depCompletion.total} clear`
                : depCount === 0
                  ? 'root node'
                  : 'dependencies'}
            </div>
          </div>
        </div>

        {/* ── Dependencies section with stat bar ───────────────────── */}
        {depCount > 0 && (
          <section className="mx-4 mb-3 border border-slate-700 bg-slate-950/55 px-3 py-2.5">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Dependencies</div>
            {depCompletion && (
              <div className="mt-2">
                <DepCompletionBar done={depCompletion.done} total={depCompletion.total} />
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-1">
              {deps.map((dep: string) => {
                const depObj = status.steps.find(s => s.id === dep) ?? status.gates.find(g => g.id === dep)
                const isDone = depObj?.status === 'DONE' || depObj?.status === 'APPROVED'
                return (
                  <span
                    key={dep}
                    className={`border px-1.5 py-0.5 font-mono text-[9px] ${
                      isDone
                        ? 'border-emerald-500/25 bg-emerald-500/8 text-emerald-200/80'
                        : 'border-amber-500/25 bg-amber-500/8 text-amber-200/80'
                    }`}
                  >
                    {dep}
                  </span>
                )
              })}
            </div>
          </section>
        )}

        {/* ── Provenance section ────────────────────────────────────── */}
        <section className="mx-4 mb-3 border border-slate-700 bg-slate-950/55 px-3 py-2.5">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Provenance</div>
          <div className="mt-2 space-y-1 font-mono text-xs text-slate-300">
            <div><strong className="text-white">ID:</strong> {nodeData.id}</div>
            {isStep && <div><strong className="text-white">Model:</strong> {step!.model}</div>}
            {isStep && step!.groupId && <div><strong className="text-white">Group:</strong> {step!.groupId}</div>}
            <div><strong className="text-white">Role:</strong> {isStep ? `${step!.type} thread step` : 'Gate checkpoint'}</div>
          </div>
        </section>

        {/* ── Action bar ───────────────────────────────────────────── */}
        <div className="flex items-center gap-1 border-t border-slate-700/40 px-4 py-2.5">
          {isStep && (
            <>
              <button
                type="button"
                onClick={() => runStep.mutate(selectedNodeId)}
                disabled={runStep.isPending}
                className="flex items-center gap-1 rounded px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-emerald-300 transition-all hover:bg-emerald-500/15"
                title="Run step"
              >
                <Play className="h-3 w-3" />
                Run
              </button>
              <button
                type="button"
                onClick={() => stopStep.mutate(selectedNodeId)}
                disabled={stopStep.isPending}
                className="flex items-center gap-1 rounded px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-rose-300 transition-all hover:bg-rose-500/15"
                title="Stop step"
              >
                <Square className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => restartStep.mutate(selectedNodeId)}
                disabled={restartStep.isPending}
                className="flex items-center gap-1 rounded px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-sky-300 transition-all hover:bg-sky-500/15"
                title="Restart step"
              >
                <RotateCcw className="h-3 w-3" />
              </button>
            </>
          )}
          {isGate && (
            <>
              <button
                type="button"
                onClick={() => approveGate.mutate(selectedNodeId)}
                disabled={approveGate.isPending || gate!.status === 'APPROVED'}
                className="flex items-center gap-1 rounded px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-emerald-300 transition-all hover:bg-emerald-500/15 disabled:opacity-40"
                title="Approve gate"
              >
                <Check className="h-3 w-3" />
                Approve
              </button>
              <button
                type="button"
                onClick={() => blockGate.mutate(selectedNodeId)}
                disabled={blockGate.isPending || gate!.status === 'BLOCKED'}
                className="flex items-center gap-1 rounded px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-rose-300 transition-all hover:bg-rose-500/15 disabled:opacity-40"
                title="Block gate"
              >
                <Ban className="h-3 w-3" />
                Block
              </button>
            </>
          )}
          <div className="ml-auto flex items-center gap-1">
            {isStep && (
              <button
                type="button"
                onClick={() => {
                  const newId = `${selectedNodeId}-copy-${Date.now().toString(36).slice(-4)}`
                  cloneStep.mutate({ sourceId: selectedNodeId, newId }, {
                    onSuccess: () => setSelectedNodeId(newId),
                  })
                }}
                disabled={cloneStep.isPending}
                className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
                title="Clone agent"
              >
                <Copy className="h-3 w-3" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="rounded p-1 text-slate-500 transition-colors hover:bg-rose-900/30 hover:text-rose-300"
              title="Delete"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>

        {confirmDelete && (
          <ConfirmDialog
            open
            title={`Delete ${selectedNodeId}?`}
            description={`This permanently removes the ${isGate ? 'gate' : 'step'} from the sequence.`}
            confirmLabel="Delete"
            tone="destructive"
            onCancel={() => setConfirmDelete(false)}
            onConfirm={() => {
              setConfirmDelete(false)
              if (isGate) {
                removeGate.mutate(selectedNodeId, { onSuccess: () => setSelectedNodeId(null) })
              } else {
                removeStep.mutate(selectedNodeId, { onSuccess: () => setSelectedNodeId(null) })
              }
            }}
          />
        )}
      </article>
    </div>
  )
}

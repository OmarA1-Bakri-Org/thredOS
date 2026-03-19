'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Copy, Play, Plus, ShieldCheck, Square, Trash2 } from 'lucide-react'
import { useUIStore } from '@/lib/ui/store'
import { useRunStep, useStopStep, useRemoveStep, useRemoveGate, useCloneStep, useStatus } from '@/lib/ui/api'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

interface ContextMenuState {
  x: number
  y: number
  nodeId: string | null
}

export function useCanvasContextMenu() {
  const [menu, setMenu] = useState<ContextMenuState | null>(null)

  const openMenu = useCallback((x: number, y: number, nodeId: string | null) => {
    setMenu({ x, y, nodeId })
  }, [])

  const closeMenu = useCallback(() => setMenu(null), [])

  return { menu, openMenu, closeMenu }
}

interface CanvasContextMenuProps {
  menu: ContextMenuState | null
  onClose: () => void
}

export function CanvasContextMenu({ menu, onClose }: CanvasContextMenuProps) {
  const openCreateDialog = useUIStore(s => s.openCreateDialog)
  const setSelectedNodeId = useUIStore(s => s.setSelectedNodeId)
  const { data: status } = useStatus()
  const runStep = useRunStep()
  const stopStep = useStopStep()
  const removeStep = useRemoveStep()
  const removeGate = useRemoveGate()
  const cloneStep = useCloneStep()
  const ref = useRef<HTMLDivElement>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [confirmRun, setConfirmRun] = useState<string | null>(null)

  const isGateNode = useCallback((nodeId: string) => {
    if (!status) return false
    return status.gates.some((g: { id: string }) => g.id === nodeId)
  }, [status])

  const handleDeleteNode = useCallback((nodeId: string) => {
    if (isGateNode(nodeId)) {
      removeGate.mutate(nodeId, { onSuccess: () => setSelectedNodeId(null) })
    } else {
      removeStep.mutate(nodeId, { onSuccess: () => setSelectedNodeId(null) })
    }
  }, [isGateNode, removeGate, removeStep, setSelectedNodeId])

  useEffect(() => {
    if (!menu) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', keyHandler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', keyHandler)
    }
  }, [menu, onClose])

  if (!menu) return confirmDelete ? (
    <ConfirmDialog
      open
      title={`Delete ${confirmDelete}?`}
      description="This permanently removes the node from the sequence."
      confirmLabel="Delete"
      tone="destructive"
      onCancel={() => setConfirmDelete(null)}
      onConfirm={() => {
        handleDeleteNode(confirmDelete!)
        setConfirmDelete(null)
      }}
    />
  ) : confirmRun ? (
    <ConfirmDialog
      open
      title={`Run ${confirmRun}?`}
      description="This dispatches the selected node and provides the explicit SAFE mode confirmation required for hosted execution."
      confirmLabel="Run node"
      tone="default"
      onCancel={() => setConfirmRun(null)}
      onConfirm={() => {
        runStep.mutate({ stepId: confirmRun, confirmPolicy: true })
        setConfirmRun(null)
      }}
    />
  ) : null

  const isNodeMenu = menu.nodeId != null

  return (
    <>
      <div
        ref={ref}
        className="fixed z-50 min-w-[180px] border border-slate-700 bg-[#08101d] py-1 shadow-[0_12px_40px_rgba(0,0,0,0.6)]"
        style={{ left: menu.x, top: menu.y }}
      >
        {isNodeMenu ? (
          <>
            <MenuItem
              icon={<Play className="h-3.5 w-3.5" />}
              label="Run"
              onClick={() => { setConfirmRun(menu.nodeId!); onClose() }}
            />
            <MenuItem
              icon={<Square className="h-3.5 w-3.5" />}
              label="Stop"
              onClick={() => { stopStep.mutate(menu.nodeId!); onClose() }}
            />
            <MenuDivider />
            <MenuItem
              icon={<Copy className="h-3.5 w-3.5" />}
              label="Clone"
              onClick={() => {
                const newId = `${menu.nodeId}-copy-${Date.now().toString(36).slice(-4)}`
                cloneStep.mutate(
                  { sourceId: menu.nodeId!, newId },
                  { onSuccess: () => setSelectedNodeId(newId) },
                )
                onClose()
              }}
            />
            <MenuItem
              icon={<Trash2 className="h-3.5 w-3.5 text-rose-400" />}
              label="Delete"
              className="text-rose-300 hover:bg-rose-500/10"
              onClick={() => { setConfirmDelete(menu.nodeId!); onClose() }}
            />
          </>
        ) : (
          <>
            <MenuItem
              icon={<Plus className="h-3.5 w-3.5 text-amber-400" />}
              label="Add Step"
              onClick={() => { openCreateDialog('step'); onClose() }}
            />
            <MenuItem
              icon={<ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />}
              label="Add Gate"
              onClick={() => { openCreateDialog('gate'); onClose() }}
            />
          </>
        )}
      </div>

      {confirmDelete ? (
        <ConfirmDialog
          open
          title={`Delete ${confirmDelete}?`}
          description="This permanently removes the node from the sequence."
          confirmLabel="Delete"
          tone="destructive"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            handleDeleteNode(confirmDelete)
            setConfirmDelete(null)
          }}
        />
      ) : null}

      {confirmRun ? (
        <ConfirmDialog
          open
          title={`Run ${confirmRun}?`}
          description="This dispatches the selected node and provides the explicit SAFE mode confirmation required for hosted execution."
          confirmLabel="Run node"
          tone="default"
          onCancel={() => setConfirmRun(null)}
          onConfirm={() => {
            runStep.mutate({ stepId: confirmRun, confirmPolicy: true })
            setConfirmRun(null)
          }}
        />
      ) : null}
    </>
  )
}

function MenuItem({
  icon,
  label,
  onClick,
  className = '',
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-slate-300 transition-colors hover:bg-slate-800/60 hover:text-white ${className}`}
    >
      {icon}
      {label}
    </button>
  )
}

function MenuDivider() {
  return <div className="my-1 border-t border-slate-800/60" />
}

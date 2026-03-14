'use client'

import { useMemo, useState, useCallback } from 'react'
import { AlertTriangle, Copy, Play, RotateCcw, ShieldCheck, Square, StopCircle, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useApproveGate, useBlockGate, useRestartStep, useRunStep, useStopStep, useRemoveStep, useRemoveGate, useCloneStep } from '@/lib/ui/api'
import { useUIStore } from '@/lib/ui/store'

type PendingAction = 'block-gate' | 'stop-step' | 'delete-node' | 'delete-gate' | null

export function StepActions({ nodeId, isGate }: { nodeId: string; isGate: boolean }) {
  const runStep = useRunStep()
  const stopStep = useStopStep()
  const restartStep = useRestartStep()
  const approveGate = useApproveGate()
  const blockGate = useBlockGate()
  const removeStep = useRemoveStep()
  const removeGate = useRemoveGate()
  const cloneStep = useCloneStep()
  const setSelectedNodeId = useUIStore(s => s.setSelectedNodeId)
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)

  const errorMessage = useMemo(() => {
    const error =
      runStep.error ??
      stopStep.error ??
      restartStep.error ??
      approveGate.error ??
      blockGate.error ??
      removeStep.error ??
      removeGate.error ??
      cloneStep.error

    return error instanceof Error ? error.message : null
  }, [approveGate.error, blockGate.error, restartStep.error, runStep.error, stopStep.error, removeStep.error, removeGate.error, cloneStep.error])

  const handleDelete = useCallback(() => {
    setPendingAction(null)
    removeStep.mutate(nodeId, {
      onSuccess: () => setSelectedNodeId(null),
    })
  }, [nodeId, removeStep, setSelectedNodeId])

  const handleClone = useCallback(() => {
    const newId = `${nodeId}-copy`
    cloneStep.mutate({ sourceId: nodeId, newId }, {
      onSuccess: () => setSelectedNodeId(newId),
    })
  }, [nodeId, cloneStep, setSelectedNodeId])

  const handleDeleteGate = useCallback(() => {
    setPendingAction(null)
    removeGate.mutate(nodeId, {
      onSuccess: () => setSelectedNodeId(null),
    })
  }, [nodeId, removeGate, setSelectedNodeId])

  if (isGate) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="success"
            onClick={() => approveGate.mutate(nodeId)}
            disabled={approveGate.isPending}
          >
            <ShieldCheck className="h-4 w-4" />
            {approveGate.isPending ? 'Approving' : 'Approve'}
          </Button>

          <Button
            type="button"
            variant="destructive"
            onClick={() => setPendingAction('block-gate')}
            disabled={blockGate.isPending}
          >
            <StopCircle className="h-4 w-4" />
            {blockGate.isPending ? 'Blocking' : 'Block'}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-slate-800/60 pt-3">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => setPendingAction('delete-gate')}
            disabled={removeGate.isPending}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {removeGate.isPending ? 'Deleting...' : 'Delete'}
          </Button>
        </div>

        {errorMessage ? (
          <div className="border border-rose-500/35 bg-rose-500/8 px-3 py-3 text-sm text-rose-100">
            {errorMessage}
          </div>
        ) : null}

        <ConfirmDialog
          open={pendingAction === 'block-gate'}
          title={`Block gate ${nodeId}?`}
          description="Blocking this gate prevents downstream progression until the gate state changes."
          confirmLabel="Block gate"
          tone="destructive"
          details={
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-rose-100">
                <AlertTriangle className="h-4 w-4" />
                This action changes execution state for dependent work.
              </div>
            </div>
          }
          onCancel={() => setPendingAction(null)}
          onConfirm={() => {
            setPendingAction(null)
            blockGate.mutate(nodeId)
          }}
        />

        <ConfirmDialog
          open={pendingAction === 'delete-gate'}
          title={`Delete gate ${nodeId}?`}
          description="This permanently removes the gate from the sequence."
          confirmLabel="Delete gate"
          tone="destructive"
          details={
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-rose-100">
                <AlertTriangle className="h-4 w-4" />
                This action cannot be undone.
              </div>
            </div>
          }
          onCancel={() => setPendingAction(null)}
          onConfirm={handleDeleteGate}
        />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="default"
          onClick={() => runStep.mutate(nodeId)}
          disabled={runStep.isPending}
        >
          <Play className="h-4 w-4" />
          {runStep.isPending ? 'Running' : 'Run'}
        </Button>

        <Button
          type="button"
          variant="destructive"
          onClick={() => setPendingAction('stop-step')}
          disabled={stopStep.isPending}
        >
          <Square className="h-4 w-4" />
          {stopStep.isPending ? 'Stopping' : 'Stop'}
        </Button>

        <Button
          type="button"
          variant="warning"
          onClick={() => restartStep.mutate(nodeId)}
          disabled={restartStep.isPending}
        >
          <RotateCcw className="h-4 w-4" />
          {restartStep.isPending ? 'Restarting' : 'Restart'}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-slate-800/60 pt-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleClone}
          disabled={cloneStep.isPending}
        >
          <Copy className="h-3.5 w-3.5" />
          {cloneStep.isPending ? 'Cloning...' : 'Clone'}
        </Button>

        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() => setPendingAction('delete-node')}
          disabled={removeStep.isPending}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {removeStep.isPending ? 'Deleting...' : 'Delete'}
        </Button>
      </div>

      {errorMessage ? (
        <div className="border border-rose-500/35 bg-rose-500/8 px-3 py-3 text-sm text-rose-100">
          {errorMessage}
        </div>
      ) : null}

      <ConfirmDialog
        open={pendingAction === 'stop-step'}
        title={`Stop step ${nodeId}?`}
        description="Stopping a running step marks the current execution as interrupted and can affect downstream thread state."
        confirmLabel="Stop step"
        tone="destructive"
        details={
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 text-rose-100">
              <AlertTriangle className="h-4 w-4" />
              Use this only when you intend to interrupt the current run.
            </div>
          </div>
        }
        onCancel={() => setPendingAction(null)}
        onConfirm={() => {
          setPendingAction(null)
          stopStep.mutate(nodeId)
        }}
      />

      <ConfirmDialog
        open={pendingAction === 'delete-node'}
        title={`Delete step ${nodeId}?`}
        description="This permanently removes the step from the sequence. Steps that depend on this one will need to be updated."
        confirmLabel="Delete step"
        tone="destructive"
        details={
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 text-rose-100">
              <AlertTriangle className="h-4 w-4" />
              This action cannot be undone.
            </div>
          </div>
        }
        onCancel={() => setPendingAction(null)}
        onConfirm={handleDelete}
      />
    </div>
  )
}

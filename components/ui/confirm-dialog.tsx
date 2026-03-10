'use client'

import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  cancelLabel?: string
  tone?: 'default' | 'destructive' | 'warning'
  onCancel: () => void
  onConfirm: () => void
  details?: ReactNode
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'destructive',
  onCancel,
  onConfirm,
  details,
}: ConfirmDialogProps) {
  if (!open) {
    return null
  }

  const confirmVariant = tone === 'warning' ? 'warning' : tone === 'destructive' ? 'destructive' : 'default'

  return (
    <div
      data-testid="confirm-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#02050a]/82 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="w-full max-w-lg border border-slate-700 bg-[#08101d] shadow-[0_28px_80px_rgba(0,0,0,0.55)]">
        <div className="border-b border-slate-800/80 px-5 py-4">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Confirm action</div>
          <h2 id="confirm-dialog-title" className="mt-2 text-xl font-semibold tracking-tight text-white">
            {title}
          </h2>
        </div>

        <div className="space-y-4 px-5 py-5 text-sm text-slate-300">
          <p>{description}</p>
          {details ? (
            <div className="border border-[#16417C]/70 bg-[#16417C]/18 px-4 py-4 text-slate-100">
              {details}
            </div>
          ) : null}
        </div>

        <div
          data-testid="confirm-dialog-actions"
          className="flex flex-wrap justify-end gap-3 border-t border-slate-800/80 px-5 py-4"
        >
          <Button type="button" variant="outline" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button type="button" variant={confirmVariant} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

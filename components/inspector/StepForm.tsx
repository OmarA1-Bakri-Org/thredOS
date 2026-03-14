'use client'

import { useState, useCallback } from 'react'
import { Check, Pencil, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useEditStep, useStatus, useAddDep, useRemoveDep } from '@/lib/ui/api'
import { ModelPopout } from './ModelPopout'

const STEP_TYPES = [
  { value: 'base', label: 'Base', color: '#64748b' },
  { value: 'p', label: 'Parallel', color: '#818cf8' },
  { value: 'c', label: 'Compute', color: '#38bdf8' },
  { value: 'f', label: 'Fusion', color: '#fbbf24' },
  { value: 'b', label: 'Branch', color: '#a78bfa' },
  { value: 'l', label: 'Loop', color: '#34d399' },
] as const

interface StepData {
  id: string
  name: string
  type: string
  model: string
  status: string
  dependsOn: string[]
}

export function StepForm({ step }: { step: StepData }) {
  const editStep = useEditStep()
  const addDep = useAddDep()
  const removeDep = useRemoveDep()
  const { data: status } = useStatus()

  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(step.name)
  const [editType, setEditType] = useState(step.type)
  const [editModel, setEditModel] = useState(step.model)
  const [error, setError] = useState<string | null>(null)

  const allNodeIds = status
    ? [...status.steps.map(s => s.id), ...status.gates.map(g => g.id)].filter(id => id !== step.id)
    : []

  const startEditing = useCallback(() => {
    setEditName(step.name)
    setEditType(step.type)
    setEditModel(step.model)
    setError(null)
    setEditing(true)
  }, [step])

  const cancelEditing = useCallback(() => {
    setEditing(false)
    setError(null)
  }, [])

  const saveEdits = useCallback(async () => {
    setError(null)
    const changes: Record<string, string> = {}
    if (editName !== step.name) changes.name = editName
    if (editType !== step.type) changes.type = editType
    if (editModel !== step.model) changes.model = editModel
    if (Object.keys(changes).length === 0) { setEditing(false); return }

    try {
      await editStep.mutateAsync({ stepId: step.id, ...changes })
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    }
  }, [editName, editType, editModel, step, editStep])

  const handleAddDep = useCallback(async (depId: string) => {
    try {
      await addDep.mutateAsync({ stepId: step.id, depId })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Add dependency failed')
    }
  }, [step.id, addDep])

  const handleRemoveDep = useCallback(async (depId: string) => {
    try {
      await removeDep.mutateAsync({ stepId: step.id, depId })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove dependency failed')
    }
  }, [step.id, removeDep])

  const availableDeps = allNodeIds.filter(id => !step.dependsOn.includes(id))

  if (!editing) {
    return (
      <div className="mt-3">
        <div className="flex items-center justify-between">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-600">Fields</div>
          <Button type="button" variant="ghost" size="sm" onClick={startEditing} className="h-6 gap-1 px-2">
            <Pencil className="h-3 w-3" />
            Edit
          </Button>
        </div>

        <div className="mt-2 space-y-3">
          <div className="border border-[#16417C]/70 bg-[#16417C]/18 px-4 py-3">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Name</div>
            <div className="mt-2 text-sm font-medium text-white">{step.name}</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="border border-slate-700 bg-slate-950/65 px-4 py-3">
              <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Type</div>
              <div className="mt-2 text-sm text-slate-100">{step.type}</div>
            </div>
            <div className="border border-slate-700 bg-slate-950/65 px-4 py-3">
              <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Model</div>
              <div className="mt-2 text-sm text-slate-100">{step.model}</div>
            </div>
          </div>
          <div className="border border-slate-700 bg-slate-950/65 px-4 py-3">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Status</div>
            <div className="mt-2 text-sm font-mono uppercase tracking-[0.14em] text-sky-100">{step.status}</div>
          </div>
          <div className="border border-slate-700 bg-slate-950/65 px-4 py-3">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">
              Dependencies
            </div>
            <div className="mt-2">
              {step.dependsOn.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {step.dependsOn.map(dep => (
                    <span key={dep} className="group flex items-center gap-1 border border-amber-500/30 bg-amber-500/8 px-2 py-0.5 font-mono text-[10px] tracking-wide text-amber-200">
                      {dep}
                      <button
                        type="button"
                        onClick={() => handleRemoveDep(dep)}
                        className="ml-0.5 hidden text-amber-400 hover:text-rose-300 group-hover:inline-block"
                        aria-label={`Remove dependency ${dep}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-sm text-slate-500">None</span>
              )}
              {availableDeps.length > 0 ? (
                <details className="mt-2">
                  <summary className="cursor-pointer font-mono text-[9px] uppercase tracking-[0.16em] text-sky-400/70 hover:text-sky-300">
                    + Add dependency
                  </summary>
                  <div className="mt-1.5 flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                    {availableDeps.map(nid => (
                      <button
                        key={nid}
                        type="button"
                        onClick={() => handleAddDep(nid)}
                        className="border border-slate-700/30 bg-transparent px-2 py-0.5 font-mono text-[10px] tracking-wide text-slate-500 transition-colors hover:border-sky-500/40 hover:text-sky-300"
                      >
                        {nid}
                      </button>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          </div>
        </div>

        {error ? (
          <div className="mt-2 border border-rose-500/35 bg-rose-500/8 px-3 py-2 font-mono text-[11px] text-rose-200">
            {error}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-400/70">Editing</div>
        <div className="flex gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={cancelEditing} className="h-6 gap-1 px-2">
            <X className="h-3 w-3" />
            Cancel
          </Button>
          <Button
            type="button"
            variant="success"
            size="sm"
            onClick={saveEdits}
            disabled={editStep.isPending}
            className="h-6 gap-1 px-2"
          >
            <Check className="h-3 w-3" />
            {editStep.isPending ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      {/* Name */}
      <div className="border border-amber-500/30 bg-amber-500/5 px-4 py-3">
        <label htmlFor="step-edit-name" className="block font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Name</label>
        <input
          id="step-edit-name"
          type="text"
          value={editName}
          onChange={e => setEditName(e.target.value)}
          placeholder="Step name"
          className="mt-1.5 w-full border border-slate-700 bg-[#0a101a] px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-500/60"
        />
      </div>

      {/* Type */}
      <div className="border border-amber-500/30 bg-amber-500/5 px-4 py-3">
        <label className="block font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Type</label>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {STEP_TYPES.map(t => (
            <button
              key={t.value}
              type="button"
              onClick={() => setEditType(t.value)}
              className="px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-all"
              style={{
                background: editType === t.value ? `${t.color}20` : 'transparent',
                color: editType === t.value ? t.color : '#64748b',
                border: `1px solid ${editType === t.value ? `${t.color}60` : 'rgba(51,65,85,0.4)'}`,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Model */}
      <div className="border border-amber-500/30 bg-amber-500/5 px-4 py-3">
        <label className="block font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Model</label>
        <div className="mt-1.5">
          <ModelPopout value={editModel} onChange={setEditModel} />
        </div>
      </div>

      {error ? (
        <div className="border border-rose-500/35 bg-rose-500/8 px-3 py-2 font-mono text-[11px] text-rose-200">
          {error}
        </div>
      ) : null}
    </div>
  )
}

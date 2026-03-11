'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Plus, ShieldCheck, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAddStep, useInsertGate, useStatus } from '@/lib/ui/api'
import { useUIStore } from '@/lib/ui/store'

const STEP_TYPES = [
  { value: 'base', label: 'Base', color: '#64748b' },
  { value: 'p', label: 'Parallel', color: '#818cf8' },
  { value: 'c', label: 'Compute', color: '#38bdf8' },
  { value: 'f', label: 'Fusion', color: '#fbbf24' },
  { value: 'b', label: 'Branch', color: '#a78bfa' },
  { value: 'l', label: 'Loop', color: '#34d399' },
] as const

const MODELS = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'shell', label: 'Shell' },
] as const

type NodeKind = 'step' | 'gate'

interface CreateNodeDialogProps {
  open: boolean
  onClose: () => void
  initialKind?: NodeKind
}

export function CreateNodeDialog({ open, onClose, initialKind = 'step' }: CreateNodeDialogProps) {
  const addStep = useAddStep()
  const insertGate = useInsertGate()
  const { data: status } = useStatus()
  const setSelectedNodeId = useUIStore(s => s.setSelectedNodeId)

  const [kind, setKind] = useState<NodeKind>(initialKind)
  const [nodeId, setNodeId] = useState('')
  const [name, setName] = useState('')
  const [stepType, setStepType] = useState('base')
  const [model, setModel] = useState('claude-code')
  const [selectedDeps, setSelectedDeps] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const idRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setKind(initialKind)
      setNodeId('')
      setName('')
      setStepType('base')
      setModel('claude-code')
      setSelectedDeps([])
      setError(null)
      setTimeout(() => idRef.current?.focus(), 50)
    }
  }, [open, initialKind])

  const existingNodes = status
    ? [...status.steps.map(s => s.id), ...status.gates.map(g => g.id)]
    : []

  const toggleDep = useCallback((dep: string) => {
    setSelectedDeps(prev => prev.includes(dep) ? prev.filter(d => d !== dep) : [...prev, dep])
  }, [])

  const handleSubmit = useCallback(async () => {
    setError(null)
    const trimmedId = nodeId.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
    if (!trimmedId) { setError('ID is required'); return }
    if (existingNodes.includes(trimmedId)) { setError(`'${trimmedId}' already exists`); return }

    try {
      if (kind === 'step') {
        await addStep.mutateAsync({
          stepId: trimmedId,
          name: name.trim() || trimmedId,
          type: stepType,
          model,
          dependsOn: selectedDeps,
        })
      } else {
        await insertGate.mutateAsync({
          gateId: trimmedId,
          name: name.trim() || trimmedId,
          dependsOn: selectedDeps,
        })
      }
      setSelectedNodeId(trimmedId)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create node')
    }
  }, [nodeId, name, kind, stepType, model, selectedDeps, existingNodes, addStep, insertGate, setSelectedNodeId, onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit()
  }, [onClose, handleSubmit])

  if (!open) return null

  const isPending = addStep.isPending || insertGate.isPending

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[#02050a]/82 px-4 pt-[12vh] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-node-title"
      onKeyDown={handleKeyDown}
    >
      <div className="w-full max-w-lg border border-slate-700 bg-[#08101d] shadow-[0_28px_80px_rgba(0,0,0,0.55)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800/80 px-5 py-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-slate-500">Construct</div>
            <h2 id="create-node-title" className="mt-1 text-lg font-semibold tracking-tight text-white">
              {kind === 'step' ? 'New Step' : 'New Gate'}
            </h2>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Kind switcher */}
        <div className="flex border-b border-slate-800/80">
          <button
            type="button"
            onClick={() => setKind('step')}
            className={`flex-1 px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.2em] transition-colors ${
              kind === 'step'
                ? 'border-b-2 border-sky-400 bg-sky-500/8 text-sky-100'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <Plus className="mr-1.5 inline h-3.5 w-3.5" />
            Step
          </button>
          <button
            type="button"
            onClick={() => setKind('gate')}
            className={`flex-1 px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.2em] transition-colors ${
              kind === 'gate'
                ? 'border-b-2 border-emerald-400 bg-emerald-500/8 text-emerald-100'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <ShieldCheck className="mr-1.5 inline h-3.5 w-3.5" />
            Gate
          </button>
        </div>

        {/* Form */}
        <div className="space-y-4 px-5 py-5">
          {/* ID field */}
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
              ID <span className="text-rose-400">*</span>
            </label>
            <input
              ref={idRef}
              type="text"
              value={nodeId}
              onChange={e => setNodeId(e.target.value)}
              placeholder="my-step-id"
              className="mt-1.5 w-full border border-slate-700 bg-[#0a101a] px-3 py-2 font-mono text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-sky-500/60"
            />
            <div className="mt-1 font-mono text-[9px] tracking-wide text-slate-600">
              lowercase, hyphens, max 64 chars
            </div>
          </div>

          {/* Name field */}
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Human-readable name"
              className="mt-1.5 w-full border border-slate-700 bg-[#0a101a] px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-sky-500/60"
            />
          </div>

          {/* Step-specific fields */}
          {kind === 'step' ? (
            <>
              {/* Type selector */}
              <div>
                <label className="block font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Thread type</label>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {STEP_TYPES.map(t => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setStepType(t.value)}
                      className="px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-all"
                      style={{
                        background: stepType === t.value ? `${t.color}20` : 'transparent',
                        color: stepType === t.value ? t.color : '#64748b',
                        border: `1px solid ${stepType === t.value ? `${t.color}60` : 'rgba(51,65,85,0.4)'}`,
                        boxShadow: stepType === t.value ? `0 0 8px ${t.color}15` : 'none',
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Model selector */}
              <div>
                <label className="block font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Model</label>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {MODELS.map(m => (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => setModel(m.value)}
                      className={`px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-all border ${
                        model === m.value
                          ? 'border-sky-500/50 bg-sky-500/12 text-sky-100'
                          : 'border-slate-700/40 bg-transparent text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : null}

          {/* Dependencies */}
          {existingNodes.length > 0 ? (
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
                Dependencies
              </label>
              <div className="mt-1.5 flex max-h-32 flex-wrap gap-1 overflow-y-auto border border-slate-800/60 bg-[#060a12] p-2">
                {existingNodes.map(nid => (
                  <button
                    key={nid}
                    type="button"
                    onClick={() => toggleDep(nid)}
                    className={`px-2 py-0.5 font-mono text-[10px] tracking-wide transition-all border ${
                      selectedDeps.includes(nid)
                        ? 'border-amber-500/50 bg-amber-500/12 text-amber-200'
                        : 'border-slate-700/30 bg-transparent text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {nid}
                  </button>
                ))}
              </div>
              {selectedDeps.length > 0 ? (
                <div className="mt-1 font-mono text-[9px] tracking-wide text-amber-400/70">
                  {selectedDeps.length} dep{selectedDeps.length > 1 ? 's' : ''} selected
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Error */}
          {error ? (
            <div className="border border-rose-500/35 bg-rose-500/8 px-3 py-2 font-mono text-[11px] text-rose-200">
              {error}
            </div>
          ) : null}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between border-t border-slate-800/80 px-5 py-4">
          <div className="font-mono text-[9px] tracking-wide text-slate-600">
            Ctrl+Enter to submit
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              type="button"
              variant={kind === 'step' ? 'default' : 'success'}
              onClick={handleSubmit}
              disabled={isPending || !nodeId.trim()}
            >
              <Plus className="h-3.5 w-3.5" />
              {isPending ? 'Creating...' : kind === 'step' ? 'Add Step' : 'Add Gate'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

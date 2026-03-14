'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Search, X } from 'lucide-react'

/** A model option shown in the popout list. */
interface ModelOption {
  id: string
  label: string
  group: 'agent' | 'model'
}

/**
 * Agent-level dispatchers — these aren't LLM model IDs, they're
 * local CLI agents ThreadOS can dispatch steps to.
 */
const AGENT_OPTIONS: ModelOption[] = [
  { id: 'claude-code', label: 'Claude Code', group: 'agent' },
  { id: 'codex', label: 'Codex CLI', group: 'agent' },
  { id: 'gemini', label: 'Gemini CLI', group: 'agent' },
  { id: 'shell', label: 'Shell', group: 'agent' },
]

/**
 * Known LLM model families from the registry.
 * These are model IDs that can be sent through the LLM provider layer.
 */
const MODEL_OPTIONS: ModelOption[] = [
  { id: 'gpt-4o', label: 'GPT-4o', group: 'model' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini', group: 'model' },
  { id: 'o4-mini', label: 'O4 Mini', group: 'model' },
  { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', group: 'model' },
  { id: 'claude-opus-4-20250514', label: 'Claude Opus 4', group: 'model' },
  { id: 'claude-haiku-4-20250514', label: 'Claude Haiku 4', group: 'model' },
  { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', group: 'model' },
  { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', group: 'model' },
  { id: 'meta-llama/llama-3.1-70b', label: 'Llama 3.1 70B', group: 'model' },
  { id: 'meta-llama/llama-4-maverick', label: 'Llama 4 Maverick', group: 'model' },
  { id: 'mistralai/mistral-large', label: 'Mistral Large', group: 'model' },
  { id: 'deepseek/deepseek-r1', label: 'DeepSeek R1', group: 'model' },
  { id: 'qwen/qwen-2.5-72b', label: 'Qwen 2.5 72B', group: 'model' },
]

const ALL_OPTIONS = [...AGENT_OPTIONS, ...MODEL_OPTIONS]

interface ModelPopoutProps {
  value: string
  onChange: (modelId: string) => void
}

export function ModelPopout({ value, onChange }: ModelPopoutProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [popoutStyle, setPopoutStyle] = useState<React.CSSProperties>({})
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoutRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Position the portal popout relative to the trigger button
  useEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPopoutStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      zIndex: 9999,
    })
  }, [open])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      const target = e.target as Node
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        popoutRef.current && !popoutRef.current.contains(target)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Focus search input when opened
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus()
    }
  }, [open])

  const handleSelect = useCallback((id: string) => {
    onChange(id)
    setOpen(false)
    setSearch('')
  }, [onChange])

  const handleCustomSubmit = useCallback(() => {
    const trimmed = search.trim()
    if (trimmed) {
      handleSelect(trimmed)
    }
  }, [search, handleSelect])

  const query = search.toLowerCase()
  const filteredAgents = AGENT_OPTIONS.filter(
    o => o.id.toLowerCase().includes(query) || o.label.toLowerCase().includes(query)
  )
  const filteredModels = MODEL_OPTIONS.filter(
    o => o.id.toLowerCase().includes(query) || o.label.toLowerCase().includes(query)
  )
  const hasResults = filteredAgents.length > 0 || filteredModels.length > 0

  // Display label for current value
  const currentOption = ALL_OPTIONS.find(o => o.id === value)
  const displayLabel = currentOption?.label ?? value

  return (
    <div className="relative">
      {/* Trigger button */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex w-full items-center justify-between gap-2 border px-3 py-1.5 text-left font-mono text-[11px] tracking-wide transition-all ${
          open
            ? 'border-sky-500/50 bg-sky-500/8 text-sky-100'
            : 'border-slate-700 bg-[#0a101a] text-slate-200 hover:border-slate-500/70 hover:shadow-[0_0_8px_rgba(148,163,184,0.15)]'
        }`}
      >
        <span className="truncate">{displayLabel}</span>
        <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Popout panel — rendered via portal so it escapes overflow:hidden ancestors */}
      {open && createPortal(
        <div ref={popoutRef} style={popoutStyle} className="max-h-[320px] overflow-hidden border border-slate-700 bg-[#0a1220] shadow-xl shadow-black/40">
          {/* Search input */}
          <div className="flex items-center gap-2 border-b border-slate-700/60 px-3 py-2">
            <Search className="h-3 w-3 shrink-0 text-slate-500" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleCustomSubmit()
                if (e.key === 'Escape') { setOpen(false); setSearch('') }
              }}
              placeholder="Search or enter model ID..."
              className="w-full bg-transparent text-[11px] text-slate-200 outline-none placeholder:text-slate-600"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                title="Clear search"
                className="text-slate-500 hover:text-slate-300"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Options list */}
          <div className="max-h-[260px] overflow-y-auto">
            {/* Agents group */}
            {filteredAgents.length > 0 && (
              <div>
                <div className="sticky top-0 bg-[#0a1220] px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-slate-600">
                  Agents
                </div>
                {filteredAgents.map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleSelect(opt.id)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-slate-800/60 ${
                      value === opt.id ? 'bg-sky-500/10 text-sky-200' : 'text-slate-300'
                    }`}
                  >
                    <span className="font-mono text-[10px]">{opt.label}</span>
                    <span className="ml-auto font-mono text-[9px] text-slate-600">{opt.id}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Models group */}
            {filteredModels.length > 0 && (
              <div>
                <div className="sticky top-0 bg-[#0a1220] px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-slate-600">
                  Models
                </div>
                {filteredModels.map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleSelect(opt.id)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-slate-800/60 ${
                      value === opt.id ? 'bg-sky-500/10 text-sky-200' : 'text-slate-300'
                    }`}
                  >
                    <span className="font-mono text-[10px]">{opt.label}</span>
                    <span className="ml-auto font-mono text-[9px] text-slate-600">{opt.id}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Custom model entry */}
            {search.trim() && !hasResults && (
              <button
                type="button"
                onClick={handleCustomSubmit}
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-slate-800/60"
              >
                <span className="font-mono text-[10px] text-sky-300">Use custom:</span>
                <span className="font-mono text-[10px] text-white">{search.trim()}</span>
              </button>
            )}

            {/* Custom entry hint when search matches exist but typed value doesn't match any option exactly */}
            {search.trim() && hasResults && !ALL_OPTIONS.some(o => o.id === search.trim()) && (
              <button
                type="button"
                onClick={handleCustomSubmit}
                className="flex w-full items-center gap-2 border-t border-slate-700/40 px-3 py-1.5 text-left transition-colors hover:bg-slate-800/60"
              >
                <span className="font-mono text-[9px] text-slate-500">Enter to use:</span>
                <span className="font-mono text-[10px] text-sky-300">{search.trim()}</span>
              </button>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

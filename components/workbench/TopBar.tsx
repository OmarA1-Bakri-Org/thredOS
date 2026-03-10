'use client'

import { useEffect, useRef, useCallback } from 'react'
import { Moon, Search, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useStatus, useRunRunnable } from '@/lib/ui/api'
import { useUIStore, type ProductEntryMode, type ThreadSurfaceViewMode } from '@/lib/ui/store'

const productEntries: Array<{ value: ProductEntryMode; label: string; disabled?: boolean }> = [
  { value: 'threados', label: 'ThreadOS' },
  { value: 'thread-runner', label: 'Thread Runner', disabled: true },
]

const viewModes: Array<{ value: ThreadSurfaceViewMode; label: string; disabled?: boolean }> = [
  { value: 'hierarchy', label: 'Hierarchy' },
  { value: 'lanes', label: 'Lanes' },
  { value: 'layers', label: 'Layers', disabled: true },
]

export function TopBar() {
  const { data: status } = useStatus()
  const runRunnable = useRunRunnable()
  const searchQuery = useUIStore(s => s.searchQuery)
  const setSearchQuery = useUIStore(s => s.setSearchQuery)
  const productEntry = useUIStore(s => s.productEntry)
  const setProductEntry = useUIStore(s => s.setProductEntry)
  const viewMode = useUIStore(s => s.viewMode)
  const setViewMode = useUIStore(s => s.setViewMode)
  const toggleInspector = useUIStore(s => s.toggleInspector)
  const toggleChat = useUIStore(s => s.toggleChat)
  const { theme, setTheme } = useTheme()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setSearchQuery(value), 200)
    },
    [setSearchQuery],
  )

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return (
    <div className="flex h-16 items-center gap-4 px-5">
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-[0.28em] text-sky-300/60">Agentic operating system</div>
        <div className="text-xl font-semibold tracking-tight text-white">threadOS</div>
      </div>

      <div className="ml-4 flex items-center gap-2">
        {productEntries.map(entry => (
          <button
            key={entry.value}
            type="button"
            onClick={() => !entry.disabled && setProductEntry(entry.value)}
            disabled={entry.disabled}
            className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.22em] transition ${productEntry === entry.value ? 'border-sky-500/60 bg-sky-500/10 text-sky-100' : 'border-slate-700 bg-slate-900/70 text-slate-300'} ${entry.disabled ? 'cursor-not-allowed opacity-45' : 'hover:border-slate-500 hover:text-white'}`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        {viewModes.map(mode => (
          <button
            key={mode.value}
            type="button"
            onClick={() => !mode.disabled && setViewMode(mode.value)}
            disabled={mode.disabled}
            className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.22em] transition ${viewMode === mode.value ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-100' : 'border-slate-700 bg-slate-950/60 text-slate-300'} ${mode.disabled ? 'cursor-not-allowed opacity-45' : 'hover:border-slate-500 hover:text-white'}`}
          >
            {mode.label}
          </button>
        ))}
      </div>

      <div className="ml-auto flex min-w-[20rem] items-center gap-3 border border-slate-800 bg-[#050913] px-3 py-2 text-sm text-slate-300">
        <Search className="h-4 w-4 text-slate-500" />
        <input
          type="text"
          defaultValue={searchQuery}
          onChange={handleSearchChange}
          placeholder="Search threads, runs, skills"
          className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
        />
      </div>

      <button
        type="button"
        onClick={() => runRunnable.mutate()}
        disabled={runRunnable.isPending}
        className="border border-sky-500/40 bg-sky-500/10 px-4 py-2 text-xs uppercase tracking-[0.2em] text-sky-100 transition hover:border-sky-400 hover:bg-sky-500/15 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {runRunnable.isPending ? 'Running' : 'Run'}
      </button>

      <button type="button" onClick={toggleInspector} className="border border-slate-700 px-3 py-2 text-xs uppercase tracking-[0.18em] text-slate-300 transition hover:border-slate-500 hover:text-white">
        Inspector
      </button>
      <button type="button" onClick={toggleChat} className="border border-slate-700 px-3 py-2 text-xs uppercase tracking-[0.18em] text-slate-300 transition hover:border-slate-500 hover:text-white">
        Thread Chat
      </button>
      <button
        type="button"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        className="border border-slate-700 p-2 text-slate-300 transition hover:border-slate-500 hover:text-white"
        aria-label="Toggle theme"
      >
        {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>

      {status ? (
        <div className="hidden min-w-[17rem] border-l border-slate-800 pl-4 text-right text-[11px] uppercase tracking-[0.18em] text-slate-400 2xl:block">
          <div className="text-slate-500">{status.name}</div>
          <div className="mt-1 flex justify-end gap-3">
            <span className="text-slate-300">Ready {status.summary.ready}</span>
            <span className="text-sky-300">Run {status.summary.running}</span>
            <span className="text-emerald-300">Done {status.summary.done}</span>
            <span className="text-rose-300">Fail {status.summary.failed}</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}

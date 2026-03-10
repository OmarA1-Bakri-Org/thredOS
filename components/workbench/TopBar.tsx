'use client'

import { useEffect, useRef, useCallback } from 'react'
import { Moon, PanelLeft, PanelRight, Search, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useRunRunnable, useStatus } from '@/lib/ui/api'
import { Button } from '@/components/ui/button'
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
  const toggleLeftRail = useUIStore(s => s.toggleLeftRail)
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
    <div className="grid h-18 grid-cols-[auto_auto_minmax(18rem,1fr)_auto] items-center gap-4 px-5 py-3 2xl:grid-cols-[auto_auto_minmax(22rem,1fr)_auto_auto]">
      <div className="flex min-w-0 items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="xl:hidden"
          onClick={toggleLeftRail}
          aria-label="Open thread navigator"
        >
          <PanelLeft className="h-4 w-4" />
        </Button>

        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.28em] text-sky-300/60">Agentic operating system</div>
          <div className="text-xl font-semibold tracking-tight text-white">threadOS</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {productEntries.map(entry => (
          <Button
            key={entry.value}
            type="button"
            variant={productEntry === entry.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => !entry.disabled && setProductEntry(entry.value)}
            disabled={entry.disabled}
            className={`rounded-full px-3 ${entry.disabled ? 'opacity-45' : ''}`}
          >
            {entry.label}
          </Button>
        ))}

        <div className="hidden h-6 border-l border-slate-800 lg:block" />

        {viewModes.map(mode => (
          <Button
            key={mode.value}
            type="button"
            variant={viewMode === mode.value ? 'success' : 'outline'}
            size="sm"
            onClick={() => !mode.disabled && setViewMode(mode.value)}
            disabled={mode.disabled}
            className={`rounded-full px-3 ${mode.disabled ? 'opacity-45' : ''}`}
          >
            {mode.label}
          </Button>
        ))}
      </div>

      <div className="flex min-w-0 items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3 border border-[#16417C]/70 bg-[#16417C]/18 px-3 py-2 text-sm text-slate-300">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            type="text"
            defaultValue={searchQuery}
            onChange={handleSearchChange}
            placeholder="Search threads, runs, skills"
            className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
          />
        </div>

        {status ? (
          <div className="hidden min-w-[16rem] border border-slate-800 bg-[#0a101a] px-3 py-2 text-right font-mono text-[11px] uppercase tracking-[0.16em] text-slate-400 2xl:block">
            <div className="text-slate-500">{status.name}</div>
            <div className="mt-2 flex justify-end gap-3">
              <span className="text-slate-300">Ready {status.summary.ready}</span>
              <span className="text-sky-300">Run {status.summary.running}</span>
              <span className="text-emerald-300">Done {status.summary.done}</span>
              <span className="text-rose-300">Fail {status.summary.failed}</span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="default"
          onClick={() => runRunnable.mutate()}
          disabled={runRunnable.isPending}
        >
          {runRunnable.isPending ? 'Running' : 'Run'}
        </Button>
        <Button type="button" variant="secondary" onClick={toggleChat}>
          Thread Chat
        </Button>
        <Button type="button" variant="outline" onClick={toggleInspector}>
          Inspector
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="2xl:hidden"
          onClick={toggleInspector}
          aria-label="Open inspector"
        >
          <PanelRight className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}

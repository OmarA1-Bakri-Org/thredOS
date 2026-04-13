'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { useTheme } from 'next-themes'
import { Sun, Moon, MessageSquare } from 'lucide-react'
import { useUIStore } from '@/lib/ui/store'
import * as uiApi from '@/lib/ui/api'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

export function Toolbar() {
  const { data: status } = uiApi.useStatus()
  const runRunnable = uiApi.useRunRunnable()
  const [confirmRun, setConfirmRun] = useState(false)
  const searchQuery = useUIStore(s => s.searchQuery)
  const setSearchQuery = useUIStore(s => s.setSearchQuery)
  const toggleMinimap = useUIStore(s => s.toggleMinimap)
  const toggleInspector = useUIStore(s => s.toggleInspector)
  const toggleChat = useUIStore(s => s.toggleChat)
  const { theme, setTheme } = useTheme()

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setSearchQuery(val), 300)
    },
    [setSearchQuery]
  )

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return (
    <div className="h-12 border-b bg-card flex items-center px-4 gap-4 shrink-0">
      <span className="font-bold text-sm">thredOS</span>
      {status && <span className="text-xs text-muted-foreground">{status.name}</span>}
      <button
        onClick={() => { setConfirmRun(true); }}
        disabled={runRunnable.isPending}
        className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
      >
        {runRunnable.isPending ? 'Running...' : 'Run Runnable'}
      </button>
      <input
        type="text"
        defaultValue={searchQuery}
        onChange={handleSearchChange}
        placeholder="Search steps..."
        className="border rounded px-2 py-1 text-sm w-48 bg-background"
      />
      <button onClick={toggleMinimap} className="text-xs text-muted-foreground hover:text-foreground">Minimap</button>
      <button onClick={toggleInspector} className="text-xs text-muted-foreground hover:text-foreground">Inspector</button>
      <button onClick={toggleChat} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
        <MessageSquare className="h-3 w-3" /> Chat
      </button>
      <button
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        className="p-1 rounded hover:bg-accent text-muted-foreground"
        aria-label="Toggle dark mode"
      >
        {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
      {status && (
        <div className="ml-auto flex gap-3 text-xs text-muted-foreground max-md:hidden">
          <span>Ready: {status.summary.ready}</span>
          <span className="text-blue-600">Running: {status.summary.running}</span>
          <span className="text-green-600">Done: {status.summary.done}</span>
          <span className="text-red-600">Failed: {status.summary.failed}</span>
        </div>
      )}
      <ConfirmDialog
        open={confirmRun}
        title="Run runnable frontier?"
        description="This dispatches the current runnable steps and acknowledges SAFE mode confirmation before hosted execution."
        confirmLabel="Run runnable"
        tone="default"
        onCancel={() => { setConfirmRun(false); }}
        onConfirm={() => {
          setConfirmRun(false);
          runRunnable.mutate({ confirmPolicy: true });
        }}
      />
    </div>
  )
}
'use client'

import type { ReactNode } from 'react'
import { PanelLeftClose, PanelRightClose } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface WorkbenchShellProps {
  topBar: ReactNode
  leftRail: ReactNode
  leftRailOpen?: boolean
  onDismissLeftRail?: () => void
  board: ReactNode
  inspector: ReactNode
  inspectorOpen?: boolean
  onDismissInspector?: () => void
  chat?: ReactNode
  chatOpen?: boolean
}

export function WorkbenchShell({
  topBar,
  leftRail,
  leftRailOpen = false,
  onDismissLeftRail,
  board,
  inspector,
  inspectorOpen = true,
  onDismissInspector,
  chat,
  chatOpen = false,
}: WorkbenchShellProps) {
  return (
    <div className="flex h-screen flex-col bg-[#060a12] text-slate-100">
      <div data-workbench-region="top-bar" className="shrink-0 border-b border-slate-800/80 bg-[#08101d]">
        {topBar}
      </div>
      <div className="flex min-h-0 flex-1">
        <aside data-workbench-region="left-rail" className="hidden w-64 shrink-0 border-r border-slate-800/80 bg-[#08101d] xl:block 2xl:w-72">
          {leftRail}
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          <div data-workbench-region="board" className="min-h-0 flex-1 bg-[#050913]">
            {board}
          </div>
          {chatOpen && chat ? (
            <div data-workbench-region="chat" className="h-72 shrink-0 border-t border-slate-800/80 bg-[#08101d]">
              {chat}
            </div>
          ) : null}
        </main>
        <aside data-workbench-region="inspector" className="hidden w-md shrink-0 border-l border-slate-800/80 bg-[#08101d] xl:block">
          {inspector}
        </aside>
      </div>

      {leftRailOpen ? (
        <div className="fixed inset-0 z-40 xl:hidden" data-workbench-region="left-rail-drawer">
          <div className="absolute inset-0 bg-[#02050a]/52 backdrop-blur-sm" onClick={onDismissLeftRail} aria-hidden="true" />
          <aside
            data-workbench-region="left-rail-drawer-panel"
            className="absolute inset-y-0 left-0 flex w-[22rem] max-w-[90vw] flex-col border-r border-slate-800/80 bg-[#08101d] shadow-[0_28px_80px_rgba(0,0,0,0.55)]"
          >
            <div className="flex items-center justify-between border-b border-slate-800/80 px-4 py-4">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Responsive rail</div>
                <div className="mt-1 text-sm font-semibold text-white">Thread navigator</div>
              </div>
              <Button type="button" variant="outline" size="icon" onClick={onDismissLeftRail} aria-label="Close thread navigator">
                <PanelLeftClose className="h-4 w-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {leftRail}
            </div>
          </aside>
        </div>
      ) : null}

      {inspectorOpen ? (
        <div className="fixed inset-0 z-40 xl:hidden" data-workbench-region="inspector-drawer">
          <div className="absolute inset-0 bg-[#02050a]/52 backdrop-blur-sm" onClick={onDismissInspector} aria-hidden="true" />
          <aside
            data-workbench-region="inspector-drawer-panel"
            className="absolute inset-y-0 right-0 flex w-md max-w-[92vw] flex-col border-l border-slate-800/80 bg-[#08101d] shadow-[0_28px_80px_rgba(0,0,0,0.55)]"
          >
            <div className="flex items-center justify-between border-b border-slate-800/80 px-4 py-4">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Responsive rail</div>
                <div className="mt-1 text-sm font-semibold text-white">Inspector</div>
              </div>
              <Button type="button" variant="outline" size="icon" onClick={onDismissInspector} aria-label="Close inspector">
                <PanelRightClose className="h-4 w-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {inspector}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  )
}
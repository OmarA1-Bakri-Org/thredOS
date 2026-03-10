'use client'

import type { ReactNode } from 'react'

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
        <aside data-workbench-region="left-rail" className="hidden w-72 shrink-0 border-r border-slate-800/80 bg-[#08101d] xl:block">
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
        <aside data-workbench-region="inspector" className="hidden w-[24rem] shrink-0 border-l border-slate-800/80 bg-[#08101d] 2xl:block">
          {inspector}
        </aside>
      </div>

      {leftRailOpen ? (
        <div className="fixed inset-0 z-40 xl:hidden" data-workbench-region="left-rail-drawer">
          <button
            type="button"
            className="absolute inset-0 bg-[#02050a]/76 backdrop-blur-sm"
            onClick={onDismissLeftRail}
            aria-label="Close thread navigator"
          />
          <aside className="absolute inset-y-0 left-0 w-[22rem] max-w-[90vw] border-r border-slate-800/80 bg-[#08101d] shadow-[0_28px_80px_rgba(0,0,0,0.55)]">
            {leftRail}
          </aside>
        </div>
      ) : null}

      {inspectorOpen ? (
        <div className="fixed inset-0 z-40 2xl:hidden" data-workbench-region="inspector-drawer">
          <button
            type="button"
            className="absolute inset-0 bg-[#02050a]/76 backdrop-blur-sm"
            onClick={onDismissInspector}
            aria-label="Close inspector"
          />
          <aside className="absolute inset-y-0 right-0 w-[24rem] max-w-[92vw] border-l border-slate-800/80 bg-[#08101d] shadow-[0_28px_80px_rgba(0,0,0,0.55)]">
            {inspector}
          </aside>
        </div>
      ) : null}
    </div>
  )
}

'use client'

import type { ReactNode } from 'react'

interface WorkbenchShellProps {
  topBar: ReactNode
  leftRail: ReactNode
  board: ReactNode
  inspector: ReactNode
  chat?: ReactNode
  chatOpen?: boolean
}

export function WorkbenchShell({ topBar, leftRail, board, inspector, chat, chatOpen = false }: WorkbenchShellProps) {
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
    </div>
  )
}

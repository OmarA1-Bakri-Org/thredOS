'use client'

import type { ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { PanelLeftClose } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getUiVariantTheme, type UiVariant } from '@/lib/ui/design-variants'
import { useUIStore } from '@/lib/ui/store'
import { cn } from '@/lib/utils'
import { FloatingChatTrigger } from '@/components/chat/FloatingChatTrigger'
import { AccordionPanel } from './AccordionPanel'

const ChatPanel = dynamic(() => import('@/components/chat/ChatPanel').then(m => m.ChatPanel), { ssr: false })

interface WorkbenchShellProps {
  topBar: ReactNode
  leftRail: ReactNode
  leftRailOpen?: boolean
  onDismissLeftRail?: () => void
  board: ReactNode
  uiVariant?: UiVariant
  previewMode?: boolean
}

export function WorkbenchShell({
  topBar,
  leftRail,
  leftRailOpen = false,
  onDismissLeftRail,
  board,
  uiVariant = 'operator-minimalism',
  previewMode = false,
}: WorkbenchShellProps) {
  const theme = getUiVariantTheme(uiVariant)
  const chatOpen = useUIStore(s => s.chatOpen)
  return (
    <div data-ui-variant={uiVariant} data-ui-preview={previewMode ? 'true' : 'false'} className={cn('flex h-screen flex-col text-slate-100', theme.workbench.shell)}>
      <div data-workbench-region="top-bar" className={cn('shrink-0 border-b', theme.workbench.topBarRegion)}>
        {topBar}
      </div>
      <div className="flex min-h-0 flex-1">
        <aside data-workbench-region="accordion-panel" className="hidden xl:block">
          <AccordionPanel />
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          <div data-workbench-region="board" className={cn('min-h-0 flex-1', theme.workbench.board)}>
            {board}
          </div>
        </main>
      </div>

      {leftRailOpen ? (
        <div className="fixed inset-0 z-40 xl:hidden" data-workbench-region="left-rail-drawer">
          <div className={cn('absolute inset-0 backdrop-blur-sm', theme.workbench.drawerBackdrop)} onClick={onDismissLeftRail} aria-hidden="true" />
          <aside
            data-workbench-region="left-rail-drawer-panel"
            className={cn('absolute inset-y-0 left-0 flex w-72 max-w-[90vw] flex-col shadow-[0_28px_80px_rgba(0,0,0,0.55)]', theme.workbench.drawerPanel)}
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

      <FloatingChatTrigger />
      {chatOpen && <ChatPanel />}
    </div>
  )
}

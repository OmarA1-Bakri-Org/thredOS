'use client'

import { useSyncExternalStore } from 'react'
import dynamic from 'next/dynamic'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { WorkbenchShell } from '@/components/workbench/WorkbenchShell'
import { TopBar } from '@/components/workbench/TopBar'
import { LeftRail } from '@/components/workbench/LeftRail'
import { InspectorRail } from '@/components/workbench/InspectorRail'
import { useUIStore } from '@/lib/ui/store'

const SequenceCanvas = dynamic(
  () => import('@/components/canvas/SequenceCanvas').then(m => m.SequenceCanvas),
  { ssr: false, loading: () => <LoadingSpinner message="Loading canvas..." /> }
)

const StepInspector = dynamic(
  () => import('@/components/inspector/StepInspector').then(m => m.StepInspector),
  { loading: () => <LoadingSpinner message="Loading inspector..." /> }
)

const ChatPanel = dynamic(
  () => import('@/components/chat/ChatPanel').then(m => m.ChatPanel),
  { loading: () => <LoadingSpinner message="Loading chat..." /> }
)

export default function Home() {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )
  const inspectorOpen = useUIStore(s => s.inspectorOpen)
  const chatOpen = useUIStore(s => s.chatOpen)

  if (!mounted) return <div className="h-screen flex flex-col"><LoadingSpinner message="Loading..." /></div>
  return (
    <WorkbenchShell
      topBar={<TopBar />}
      leftRail={<LeftRail />}
      board={
        <ErrorBoundary>
          <SequenceCanvas />
        </ErrorBoundary>
      }
      inspector={
        inspectorOpen ? (
          <ErrorBoundary>
            <InspectorRail>
              <StepInspector />
            </InspectorRail>
          </ErrorBoundary>
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-sm text-slate-500">Inspector hidden</div>
        )
      }
      chat={
        <ErrorBoundary>
          <ChatPanel />
        </ErrorBoundary>
      }
      chatOpen={chatOpen}
    />
  )
}

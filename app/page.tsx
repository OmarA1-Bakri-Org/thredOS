'use client'

import { useSyncExternalStore } from 'react'
import dynamic from 'next/dynamic'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { ProductEntryScreen } from '@/components/entry/ProductEntryScreen'
import { WorkbenchShell } from '@/components/workbench/WorkbenchShell'
import { TopBar } from '@/components/workbench/TopBar'
import { LeftRail } from '@/components/workbench/LeftRail'
import { InspectorRail } from '@/components/workbench/InspectorRail'
import { CreateNodeDialog } from '@/components/command/CreateNodeDialog'
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
  const leftRailOpen = useUIStore(s => s.leftRailOpen)
  const closeLeftRail = useUIStore(s => s.closeLeftRail)
  const closeInspector = useUIStore(s => s.closeInspector)
  const chatOpen = useUIStore(s => s.chatOpen)
  const productEntry = useUIStore(s => s.productEntry)
  const setProductEntry = useUIStore(s => s.setProductEntry)
  const createDialogOpen = useUIStore(s => s.createDialogOpen)
  const createDialogKind = useUIStore(s => s.createDialogKind)
  const closeCreateDialog = useUIStore(s => s.closeCreateDialog)

  if (!mounted) return <div className="h-screen flex flex-col"><LoadingSpinner message="Loading..." /></div>
  if (productEntry == null) {
    return <ProductEntryScreen onEnterThreadOS={() => setProductEntry('threados')} />
  }

  return (
    <>
    {createDialogOpen && <CreateNodeDialog open onClose={closeCreateDialog} initialKind={createDialogKind} />}
    <WorkbenchShell
      topBar={<TopBar />}
      leftRail={<LeftRail />}
      leftRailOpen={leftRailOpen}
      onDismissLeftRail={closeLeftRail}
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
          <div className="flex h-full items-center justify-center px-6 text-sm text-slate-500">Select a thread surface or node to inspect.</div>
        )
      }
      inspectorOpen={inspectorOpen}
      onDismissInspector={closeInspector}
      chat={
        <ErrorBoundary>
          <ChatPanel />
        </ErrorBoundary>
      }
      chatOpen={chatOpen}
    />
    </>
  )
}

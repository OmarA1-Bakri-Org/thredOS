'use client'

import { useSyncExternalStore } from 'react'
import dynamic from 'next/dynamic'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { ProductEntryScreen } from '@/components/entry/ProductEntryScreen'
import { WorkbenchShell } from '@/components/workbench/WorkbenchShell'
import { TopBar } from '@/components/workbench/TopBar'
import { LeftRail } from '@/components/workbench/LeftRail'
import { CreateNodeDialog } from '@/components/command/CreateNodeDialog'
import { ThreadRunnerGate } from '@/components/thread-runner/ThreadRunnerGate'
import { useUIStore } from '@/lib/ui/store'

const SequenceCanvas = dynamic(
  () => import('@/components/canvas/SequenceCanvas').then(m => m.SequenceCanvas),
  { ssr: false, loading: () => <LoadingSpinner message="Loading canvas..." /> }
)

export default function Home() {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )
  const leftRailOpen = useUIStore(s => s.leftRailOpen)
  const closeLeftRail = useUIStore(s => s.closeLeftRail)
  const productEntry = useUIStore(s => s.productEntry)
  const setProductEntry = useUIStore(s => s.setProductEntry)
  const createDialogOpen = useUIStore(s => s.createDialogOpen)
  const createDialogKind = useUIStore(s => s.createDialogKind)
  const closeCreateDialog = useUIStore(s => s.closeCreateDialog)

  if (!mounted) return <div className="h-screen flex flex-col"><LoadingSpinner message="Loading..." /></div>
  if (productEntry == null) {
    return <ProductEntryScreen onEnterThreadOS={() => setProductEntry('threados')} />
  }
  if (productEntry === 'thread-runner') {
    return <ThreadRunnerGate />
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
    />
    </>
  )
}

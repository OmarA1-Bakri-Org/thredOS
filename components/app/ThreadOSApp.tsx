'use client'

import { useEffect, useSyncExternalStore } from 'react'
import dynamic from 'next/dynamic'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { WorkbenchShell } from '@/components/workbench/WorkbenchShell'
import { TopBar } from '@/components/workbench/TopBar'
import { LeftRail } from '@/components/workbench/LeftRail'
import { CreateNodeDialog } from '@/components/command/CreateNodeDialog'
import { DesktopRuntimeBridge } from '@/components/desktop/DesktopRuntimeBridge'
import { useUIStore } from '@/lib/ui/store'

const SequenceCanvas = dynamic(
  () => import('@/components/canvas/SequenceCanvas').then(m => m.SequenceCanvas),
  { ssr: false, loading: () => <LoadingSpinner message="Loading canvas..." /> }
)

export function ThredOSApp() {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )
  const leftRailOpen = useUIStore(s => s.leftRailOpen)
  const closeLeftRail = useUIStore(s => s.closeLeftRail)
  const createDialogOpen = useUIStore(s => s.createDialogOpen)
  const createDialogKind = useUIStore(s => s.createDialogKind)
  const closeCreateDialog = useUIStore(s => s.closeCreateDialog)
  const setProductEntry = useUIStore(s => s.setProductEntry)

  useEffect(() => {
    setProductEntry('thredos')
  }, [setProductEntry])

  if (!mounted) {
    return <div className="flex h-screen flex-col"><LoadingSpinner message="Loading..." /></div>
  }

  return (
    <>
      <DesktopRuntimeBridge />
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

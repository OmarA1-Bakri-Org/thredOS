'use client'

import dynamic from 'next/dynamic'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { Toolbar } from '@/components/toolbar/Toolbar'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { LoadingSpinner } from '@/components/LoadingSpinner'
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
  const inspectorOpen = useUIStore(s => s.inspectorOpen)
  const chatOpen = useUIStore(s => s.chatOpen)

  return (
    <div className="h-screen flex flex-col">
      <Toolbar />
      <Group orientation="vertical" className="flex-1">
        <Panel defaultSize={chatOpen ? 70 : 100} minSize={30}>
          <Group orientation="horizontal" className="h-full">
            <Panel defaultSize={inspectorOpen ? 70 : 100} minSize={40}>
              <ErrorBoundary>
                <SequenceCanvas />
              </ErrorBoundary>
            </Panel>
            <Separator className={inspectorOpen ? '' : 'hidden'} />
            <Panel defaultSize={30} minSize={20} className={inspectorOpen ? '' : 'hidden'}>
              <ErrorBoundary>
                <div className="h-full overflow-auto border-l" style={{ display: inspectorOpen ? 'block' : 'none' }}>
                  <StepInspector />
                </div>
              </ErrorBoundary>
            </Panel>
          </Group>
        </Panel>
        <Separator className={chatOpen ? '' : 'hidden'} />
        <Panel defaultSize={30} minSize={15} className={chatOpen ? '' : 'hidden'}>
          <div className="h-full border-t" style={{ display: chatOpen ? 'block' : 'none' }}>
            <ErrorBoundary>
              <ChatPanel />
            </ErrorBoundary>
          </div>
        </Panel>
      </Group>
    </div>
  )
}

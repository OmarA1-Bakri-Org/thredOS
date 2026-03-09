import type { ReactNode } from 'react'

export interface HierarchyViewNode {
  id: string
  surfaceLabel: string
  depth: number
  childCount: number
  runStatus: string | null
  runSummary: string | null
  clickTarget: {
    threadSurfaceId: string
    runId: string | null
  }
}

interface HierarchyViewProps {
  nodes: HierarchyViewNode[]
  selectedThreadSurfaceId: string | null
  onOpenLane: (threadSurfaceId: string, runId: string | null) => void
}

function renderSummary(runStatus: string | null, runSummary: string | null): ReactNode {
  if (!runStatus && !runSummary) return null
  return (
    <div className="mt-2 text-xs text-muted-foreground">
      <div>{runStatus ? `Run status: ${runStatus}` : 'No run status available'}</div>
      {runSummary ? <div>{runSummary}</div> : null}
    </div>
  )
}

export function HierarchyView({ nodes, selectedThreadSurfaceId, onOpenLane }: HierarchyViewProps) {
  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">Hierarchy</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Structural thread surfaces. Select a thread to open its lane view.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {nodes.map(node => {
          const isSelected = selectedThreadSurfaceId === node.clickTarget.threadSurfaceId
          return (
            <button
              key={node.id}
              type="button"
              data-thread-surface-id={node.clickTarget.threadSurfaceId}
              aria-current={isSelected ? 'page' : undefined}
              onClick={() => onOpenLane(node.clickTarget.threadSurfaceId, node.clickTarget.runId)}
              className={[
                'rounded-xl border px-4 py-3 text-left transition-colors',
                isSelected ? 'border-primary bg-primary/10' : 'border-border bg-card hover:border-primary/60',
              ].join(' ')}
              style={{ marginLeft: `${node.depth * 20}px` }}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">{node.surfaceLabel}</div>
                  <div className="text-xs text-muted-foreground">{node.childCount} child surface{node.childCount === 1 ? '' : 's'}</div>
                </div>
                {node.runStatus ? (
                  <span className="rounded-full border border-border px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    {node.runStatus}
                  </span>
                ) : null}
              </div>
              {renderSummary(node.runStatus, node.runSummary)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

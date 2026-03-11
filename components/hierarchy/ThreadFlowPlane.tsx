import { Fragment } from 'react'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { HierarchyViewNode } from './HierarchyView'

interface ThreadFlowPlaneProps {
  nodes: HierarchyViewNode[]
  edges: { source: string; target: string }[]
  selectedThreadSurfaceId: string | null
  onSelectNode: (threadSurfaceId: string, runId: string | null) => void
}

const layerLabels: Record<number, string> = {
  0: 'Champion',
  1: 'Frontline',
  2: 'Mini',
}

function statusDot(runStatus: string | null): string {
  if (runStatus === 'running') return 'bg-sky-400'
  if (runStatus === 'successful') return 'bg-emerald-400'
  if (runStatus === 'failed') return 'bg-rose-400'
  return 'bg-slate-600'
}

function groupByLayer(nodes: HierarchyViewNode[]) {
  const layerMap = new Map<number, HierarchyViewNode[]>()
  for (const node of nodes) {
    const arr = layerMap.get(node.depth) ?? []
    arr.push(node)
    layerMap.set(node.depth, arr)
  }
  return Array.from(layerMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([depth, layerNodes]) => ({ depth, nodes: layerNodes }))
}

function buildParentMap(edges: { source: string; target: string }[], nodes: HierarchyViewNode[]) {
  const labelById = new Map(nodes.map(n => [n.clickTarget.threadSurfaceId, n.surfaceLabel]))
  const parentMap = new Map<string, string[]>()
  for (const edge of edges) {
    const parentLabel = labelById.get(edge.source)
    if (!parentLabel) continue
    const existing = parentMap.get(edge.target) ?? []
    existing.push(parentLabel)
    parentMap.set(edge.target, existing)
  }
  return parentMap
}

export function ThreadFlowPlane({ nodes, edges, selectedThreadSurfaceId, onSelectNode }: ThreadFlowPlaneProps) {
  const layers = groupByLayer(nodes)
  const parentMap = buildParentMap(edges, nodes)

  if (layers.length === 0) return null

  return (
    <div data-testid="thread-flow-plane" className="flex items-start gap-1 overflow-x-auto">
      {layers.map((layer, layerIndex) => (
        <Fragment key={layer.depth}>
          {layerIndex > 0 && (
            <div className="flex shrink-0 items-center self-stretch px-2 pt-7">
              <div className="h-px w-5 bg-slate-700/80" />
              <ArrowRight className="h-3 w-3 shrink-0 text-slate-600" />
            </div>
          )}
          <div className="flex min-w-[11rem] shrink-0 flex-col gap-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
              Layer {layer.depth} · {layerLabels[layer.depth] ?? 'Sub'}
            </div>
            {layer.nodes.map(node => {
              const isSelected = node.clickTarget.threadSurfaceId === selectedThreadSurfaceId
              const parents = parentMap.get(node.clickTarget.threadSurfaceId)
              return (
                <button
                  key={node.id}
                  type="button"
                  data-thread-surface-id={node.clickTarget.threadSurfaceId}
                  aria-current={isSelected ? 'page' : undefined}
                  onClick={() => onSelectNode(node.clickTarget.threadSurfaceId, node.clickTarget.runId)}
                  className={cn(
                    'border px-3 py-2 text-left transition-colors',
                    isSelected
                      ? 'border-sky-500/50 bg-sky-500/8 text-white shadow-[0_0_0_1px_rgba(96,165,250,0.15)]'
                      : 'border-slate-800 bg-[#0a101a] text-slate-300 hover:border-slate-700',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', statusDot(node.runStatus))} />
                    <span className="text-sm font-medium leading-tight">{node.surfaceLabel}</span>
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-slate-500">
                    {node.childCount} child{node.childCount !== 1 ? 'ren' : ''} · {node.runStatus ?? 'draft'}
                  </div>
                  {parents && parents.length > 0 && (
                    <div className="mt-1 font-mono text-[10px] text-slate-600">
                      ← {parents.join(', ')}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </Fragment>
      ))}
    </div>
  )
}

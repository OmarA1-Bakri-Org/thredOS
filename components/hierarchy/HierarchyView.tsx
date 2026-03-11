import { CompactThreadCard } from './CompactThreadCard'
import { FocusedThreadCard, type ThreadCardProfile } from './FocusedThreadCard'
import { ThreadFlowPlane } from './ThreadFlowPlane'

export interface HierarchyViewNode {
  id: string
  surfaceLabel: string
  depth: number
  childCount: number
  runStatus: string | null
  runSummary: string | null
  role?: string | null
  surfaceDescription?: string | null
  clickTarget: {
    threadSurfaceId: string
    runId: string | null
  }
}

interface HierarchyViewProps {
  nodes: HierarchyViewNode[]
  edges?: { source: string; target: string }[]
  selectedThreadSurfaceId: string | null
  onSelectThread?: (threadSurfaceId: string, runId: string | null) => void
  onOpenLane: (threadSurfaceId: string, runId: string | null) => void
}

function deriveProfile(node: HierarchyViewNode): ThreadCardProfile {
  const division = node.depth === 0 ? 'Champion' : node.depth === 1 ? 'Frontline' : 'Mini'
  const classification = node.role === 'orchestrator' ? 'Prompting' : node.role === 'synthesis' ? 'Closed Source' : 'Open Champion'
  const placement = node.runStatus === 'running' ? 'Finalist' : node.runStatus === 'successful' ? '1st' : 'Challenger'
  const childWeight = Math.min(node.childCount, 5)
  const summaryWeight = node.runSummary ? Math.min(Math.ceil(node.runSummary.length / 24), 3) : 0
  const threadPower = Math.min(9.6, 6.2 + childWeight * 0.45 + summaryWeight * 0.35 + (node.runStatus === 'running' ? 0.6 : node.runStatus === 'successful' ? 0.9 : 0.2))
  const weight = Math.min(9.4, 4.6 + childWeight * 0.55 + (node.depth === 0 ? 1.5 : node.depth === 1 ? 0.8 : 0.2))

  return {
    builder: 'ThreadOS Registry',
    pack: placement === '1st' ? "Champion's Pack" : placement === 'Finalist' ? 'Hero Pack' : 'Challenger Pack',
    division,
    classification,
    placement,
    verified: node.runStatus === 'running' || node.runStatus === 'successful',
    threadPower: Number(threadPower.toFixed(1)),
    weight: Number(weight.toFixed(1)),
    delta: node.runStatus === 'running' ? '+0.9 from verified runs' : '+0.4 from successful runs',
    rubric: [
      { label: 'Tools', value: Math.min(10, 5 + childWeight) },
      { label: 'Model', value: node.depth === 0 ? 8 : node.depth === 1 ? 7 : 6 },
      { label: 'Autonomy', value: node.role === 'orchestrator' ? 8 : 6 },
      { label: 'Coordination', value: Math.min(10, 4 + node.childCount + (node.depth === 0 ? 2 : 0)) },
      { label: 'Reliability', value: node.runStatus === 'successful' ? 8 : node.runStatus === 'running' ? 7 : 5 },
      { label: 'Economy', value: Math.max(3, 8 - childWeight) },
    ],
    skills: [
      { id: 'search', label: 'Search', inherited: false },
      { id: 'browser', label: 'Browser', inherited: false },
      { id: 'model', label: 'Model', inherited: false },
      { id: 'tools', label: 'Tools', inherited: false },
      { id: 'files', label: 'Files', inherited: true },
      { id: 'orchestration', label: 'Orchestration', inherited: true },
    ],
  }
}

export function HierarchyView({ nodes, edges = [], selectedThreadSurfaceId, onSelectThread, onOpenLane }: HierarchyViewProps) {
  const handleSelect = onSelectThread ?? onOpenLane
  const focusedNode = nodes.find(node => node.clickTarget.threadSurfaceId === selectedThreadSurfaceId) ?? nodes[0] ?? null
  const compactNodes = focusedNode ? nodes.filter(node => node.id !== focusedNode.id) : []

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[radial-gradient(circle_at_top,rgba(29,78,216,0.12),transparent_28%),linear-gradient(180deg,#07101b,#050913)] text-slate-100">
      <div className="border-b border-slate-800/80 px-6 py-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.24em] text-slate-500">Hierarchy</div>
        <h2 className="mt-1 text-lg font-semibold tracking-tight text-white">Structural thread surfaces</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">Select a thread to inspect its profile and jump into lane execution.</p>
      </div>

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-size-[40px_40px] opacity-35" />
        <div className="absolute inset-0 bg-black/26 backdrop-blur-[5px]" />

        <div className="relative z-10 space-y-4 px-6 py-5">
          {nodes.length > 0 && (
            <section className="border border-slate-700/60 bg-[#0a101a]/80 px-4 py-4">
              <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Sequence Flow</div>
              <ThreadFlowPlane
                nodes={nodes}
                edges={edges}
                selectedThreadSurfaceId={selectedThreadSurfaceId}
                onSelectNode={handleSelect}
              />
            </section>
          )}

          {focusedNode ? (
            <FocusedThreadCard
              node={focusedNode}
              profile={deriveProfile(focusedNode)}
              onOpenLane={onOpenLane}
            />
          ) : nodes.length === 0 ? (
            <div className="border border-dashed border-slate-800 px-6 py-12 text-center text-sm text-slate-500">No thread surfaces available yet.</div>
          ) : null}

          {compactNodes.length > 0 && (
            <div className="flex gap-3 overflow-x-auto pb-3">
              {compactNodes.map(node => (
                <CompactThreadCard
                  key={node.id}
                  node={node}
                  selected={selectedThreadSurfaceId === node.clickTarget.threadSurfaceId}
                  onSelect={handleSelect}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

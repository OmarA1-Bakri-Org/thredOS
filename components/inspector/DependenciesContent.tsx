'use client'

import { useUIStore } from '@/lib/ui/store'
import { useStatus } from '@/lib/ui/api'

export function DependenciesContent() {
  const selectedNodeId = useUIStore(s => s.selectedNodeId)
  const { data: status } = useStatus()

  if (!selectedNodeId || !status) {
    return <div className="text-sm text-slate-500">Select a node to see dependencies.</div>
  }

  const step = status.steps.find(s => s.id === selectedNodeId)
  const gate = status.gates.find(g => g.id === selectedNodeId)
  const node = step ?? gate

  if (!node) {
    return <div className="text-sm text-slate-500">Node not found.</div>
  }

  return (
    <div className="space-y-3">
      <div className="text-sm text-slate-100">
        <strong className="text-white">Dependencies:</strong>{' '}
        {node.dependsOn.length > 0 ? node.dependsOn.join(', ') : 'None'}
      </div>
      {node.dependsOn.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {node.dependsOn.map(dep => (
            <span key={dep} className="border border-amber-500/30 bg-amber-500/8 px-2 py-0.5 font-mono text-[10px] tracking-wide text-amber-200">
              {dep}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

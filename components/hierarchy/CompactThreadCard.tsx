'use client'

import { Layers3, Play, Search, ShieldCheck, Sparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { HierarchyViewNode } from './HierarchyView'

interface CompactThreadCardProps {
  node: HierarchyViewNode
  selected: boolean
  onSelect: (threadSurfaceId: string, runId: string | null) => void
}

function deriveIcons(node: HierarchyViewNode): LucideIcon[] {
  const icons: LucideIcon[] = []
  if (node.role === 'orchestrator') icons.push(Sparkles)
  if (node.childCount > 0) icons.push(Layers3)
  if (node.runStatus === 'running') icons.push(Play)
  if (node.runStatus === 'successful') icons.push(ShieldCheck)
  if (!icons.includes(Search)) icons.push(Search)
  return icons.slice(0, 4)
}

export function CompactThreadCard({ node, selected, onSelect }: CompactThreadCardProps) {
  return (
    <button
      type="button"
      data-thread-surface-id={node.clickTarget.threadSurfaceId}
      aria-current={selected ? 'page' : undefined}
      onClick={() => onSelect(node.clickTarget.threadSurfaceId, node.clickTarget.runId)}
      className={cn(
        buttonVariants({ variant: selected ? 'secondary' : 'outline' }),
        'flex h-auto w-56 shrink-0 flex-col items-start px-4 py-4 text-left normal-case tracking-normal',
        selected ? 'border-sky-500/50 text-white shadow-[0_0_0_1px_rgba(96,165,250,0.15)]' : 'text-slate-300',
      )}
      style={{ transform: selected ? 'scale(1.03)' : 'scale(1)' }}
    >
      <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">{node.runStatus ?? 'thread surface'}</div>
      <div className="mt-2 text-lg font-semibold leading-tight">{node.surfaceLabel}</div>
      <div className="mt-2 text-sm text-slate-400">{node.childCount} child surface{node.childCount === 1 ? '' : 's'}</div>
      <div className="mt-4 flex gap-2 text-slate-400">
        {deriveIcons(node).map((Icon, index) => (
          <span key={index} className="grid h-7 w-7 place-items-center border border-slate-800 bg-slate-900/80">
            <Icon className="h-3.5 w-3.5" />
          </span>
        ))}
      </div>
    </button>
  )
}

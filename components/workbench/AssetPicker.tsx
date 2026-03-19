'use client'

import { Check, LibraryBig } from 'lucide-react'

export interface AssetPickerItem {
  id: string
  title: string
  summary: string
  path: string
  version: number
  tags?: string[]
}

export interface AssetPickerProps {
  title: string
  items: AssetPickerItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  emptyLabel: string
}

export function AssetPicker({ title, items, selectedId, onSelect, emptyLabel }: AssetPickerProps) {
  return (
    <section className="space-y-2 border border-slate-800 bg-[#0a101a] px-3 py-3">
      <div className="flex items-center gap-2">
        <LibraryBig className="h-3.5 w-3.5 text-slate-500" />
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">{title}</div>
      </div>

      {items.length === 0 ? (
        <div className="border border-dashed border-slate-800 px-3 py-4 text-sm text-slate-500">{emptyLabel}</div>
      ) : (
        <div className="grid gap-2">
          {items.map(item => {
            const selected = item.id === selectedId
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                className={`w-full border px-3 py-2.5 text-left transition-all ${
                  selected
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-white'
                    : 'border-slate-800 bg-[#060e1a] text-slate-300 hover:border-slate-600 hover:bg-slate-900/80'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{item.title}</div>
                    <div className="mt-1 text-xs leading-5 text-slate-500">{item.summary}</div>
                  </div>
                  {selected ? <Check className="h-4 w-4 text-emerald-300" /> : null}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="rounded-full border border-slate-700 bg-slate-950/70 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-slate-400">{item.path}</span>
                  <span className="rounded-full border border-slate-700 bg-slate-950/70 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-slate-400">v{item.version}</span>
                  {item.tags?.map(tag => (
                    <span key={tag} className="rounded-full border border-slate-700 bg-slate-950/70 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">
                      {tag}
                    </span>
                  ))}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}

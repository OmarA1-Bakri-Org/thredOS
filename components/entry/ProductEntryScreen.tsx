'use client'

import { ArrowRight, LockKeyhole, Network, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ProductEntryScreenProps {
  onEnterThreadOS: () => void
}

export function ProductEntryScreen({ onEnterThreadOS }: ProductEntryScreenProps) {
  return (
    <div className="flex min-h-screen bg-[#060a12] text-slate-100">
      <div className="m-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-12">
        <div className="space-y-4 border border-[#16417C]/55 bg-[#08101d] px-8 py-8 shadow-[0_28px_80px_rgba(0,0,0,0.45)]">
          <div className="font-mono text-[11px] uppercase tracking-[0.28em] text-sky-300/60">
            Agentic operating system
          </div>
          <div className="space-y-3">
            <h1 className="max-w-4xl text-5xl font-light tracking-[-0.04em] text-white">
              Choose the environment you want to enter.
            </h1>
            <p className="max-w-3xl text-sm leading-7 text-slate-300">
              ThreadOS is the engineering workbench for building, inspecting, and improving agentic
              systems. Thread Runner is the locked proving layer for verified competitive runs.
            </p>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <button
            type="button"
            data-entry-option="threados"
            onClick={onEnterThreadOS}
            className="group flex h-full flex-col justify-between border border-sky-500/30 bg-[#08101d] p-8 text-left shadow-[0_28px_80px_rgba(0,0,0,0.45)] transition-colors hover:border-sky-400/60 hover:bg-[#0a1424]"
          >
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <span className="rounded-full border border-sky-500/35 bg-sky-500/10 px-4 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-sky-100">
                  ThreadOS
                </span>
                <Network className="h-5 w-5 text-sky-300" />
              </div>
              <div className="space-y-3">
                <h2 className="text-4xl font-light tracking-[-0.04em] text-white">Build on the workbench</h2>
                <p className="max-w-2xl text-sm leading-7 text-slate-300">
                  Enter the structural and runtime control surface for thread hierarchy, lane truth,
                  skills, provenance, and workflow engineering.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="border border-slate-800/90 bg-[#08111f] px-4 py-4">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Modes</div>
                  <div className="mt-2 text-sm text-slate-100">Hierarchy, Lanes, Layers</div>
                </div>
                <div className="border border-slate-800/90 bg-[#08111f] px-4 py-4">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Focus</div>
                  <div className="mt-2 text-sm text-slate-100">Threads, runs, provenance</div>
                </div>
                <div className="border border-slate-800/90 bg-[#08111f] px-4 py-4">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">State</div>
                  <div className="mt-2 text-sm text-slate-100">Live local-first workflow model</div>
                </div>
              </div>
            </div>

            <div className="mt-8 flex items-center justify-between border-t border-slate-800/90 pt-6">
              <span className="text-sm text-slate-300">Open the engineering environment</span>
              <Button type="button" variant="default" className="group-hover:border-sky-300/70">
                Enter ThreadOS
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </button>

          <div className="flex h-full flex-col justify-between border border-slate-800/90 bg-[#08101d] p-8 shadow-[0_28px_80px_rgba(0,0,0,0.45)]">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <span
                  data-entry-option="thread-runner"
                  className="rounded-full border border-amber-500/35 bg-amber-500/10 px-4 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-amber-100"
                >
                  Thread Runner
                </span>
                <Trophy className="h-5 w-5 text-amber-300" />
              </div>
              <div className="space-y-3">
                <h2 className="text-3xl font-light tracking-[-0.04em] text-white">Locked proving layer</h2>
                <p className="text-sm leading-7 text-slate-300">
                  Verified VM runs, qualifiers, and pack-grade records live here. Registration and an
                  active subscription are required before entry.
                </p>
              </div>
              <div className="space-y-3 border border-[#16417C]/55 bg-[#16417C]/16 px-5 py-5">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-sky-300/70">Requirements</div>
                <ul className="space-y-2 text-sm text-slate-200">
                  <li>Verified ThreadOS identity</li>
                  <li>Managed VM runtime access</li>
                  <li>Active paid subscription</li>
                </ul>
              </div>
            </div>

            <div className="mt-8 flex items-center justify-between border-t border-slate-800/90 pt-6">
              <span className="flex items-center gap-2 text-sm text-slate-400">
                <LockKeyhole className="h-4 w-4 text-amber-300" />
                Locked until eligible
              </span>
              <Button
                type="button"
                variant="warning"
                disabled
                data-entry-option="thread-runner"
                aria-label="Thread Runner is locked until eligible"
              >
                Locked
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

'use client'

import { ArrowRight, Library, Network, ShieldCheck, Sparkles } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ProductEntryScreenProps } from './ProductEntryScreen'

function handleEnter(
  primaryHref: string | undefined,
  onEnterThredOS: (() => void) | undefined,
  onEnterThreadOS: (() => void) | undefined,
) {
  if (onEnterThredOS) {
    onEnterThredOS()
    return
  }

  if (onEnterThreadOS) {
    onEnterThreadOS()
    return
  }

  if (primaryHref && typeof window !== 'undefined') {
    window.location.assign(primaryHref)
  }
}

export function ProductEntryScreenClient({
  isHostedMode = false,
  isAuthenticated = false,
  primaryHref,
  onEnterThredOS,
  onEnterThreadOS,
}: ProductEntryScreenProps) {
  const primaryLabel = isAuthenticated ? 'Open Desktop Surface' : isHostedMode ? 'Activate Desktop' : 'Open thredOS'

  return (
    <div className="flex min-h-screen bg-[#060a12] text-slate-100">
      <div className="m-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-12">
        <div className="space-y-4 border border-[#16417C]/55 bg-[#08101d] px-8 py-8 shadow-[0_28px_80px_rgba(0,0,0,0.45)]">
          <div className="font-mono text-[11px] uppercase tracking-[0.28em] text-sky-300/60">
            thredOS Desktop public beta
          </div>
          <div className="space-y-3">
            <h1 className="max-w-4xl text-5xl font-light tracking-[-0.04em] text-white">
              Local-first control for agent work, with your workspace staying yours.
            </h1>
            <p className="max-w-3xl text-sm leading-7 text-slate-300">
              thredOS Desktop keeps prompts, skills, threads, surfaces, runs, and artifacts on
              your machine. The cloud is used only for activation, billing, and canonical agent
              registration plus performance history.
            </p>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.18fr)_minmax(0,0.82fr)]">
          <div
            data-entry-option="thredos"
            className="group flex h-full flex-col justify-between border border-sky-500/30 bg-[#08101d] p-8 text-left shadow-[0_28px_80px_rgba(0,0,0,0.45)]"
          >
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <span className="rounded-full border border-sky-500/35 bg-sky-500/10 px-4 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-sky-100">
                  thredOS Desktop
                </span>
                <Network className="h-5 w-5 text-sky-300" />
              </div>
              <div className="space-y-3">
                <h2 className="text-4xl font-light tracking-[-0.04em] text-white">Local-first operating surface for agent systems</h2>
                <p className="max-w-2xl text-sm leading-7 text-slate-300">
                  Design nodes, register agents, bind prompts and skills, run across structured
                  thread surfaces, and inspect lineage locally. Your workspace stays private unless
                  you choose a future user-controlled thredOS Node runtime.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="border border-slate-800/90 bg-[#08111f] px-4 py-4">
                  <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-300">
                    <Library className="h-3.5 w-3.5 text-sky-300/80" />
                    Library
                  </div>
                  <div className="mt-2 text-sm text-slate-100">Local prompts, local skills, canonical agents</div>
                </div>
                <div className="border border-slate-800/90 bg-[#08111f] px-4 py-4">
                  <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-300">
                    <Sparkles className="h-3.5 w-3.5 text-sky-300/80" />
                    Surfaces
                  </div>
                  <div className="mt-2 text-sm text-slate-100">Tiered parent and child execution planes</div>
                </div>
                <div className="border border-slate-800/90 bg-[#08111f] px-4 py-4">
                  <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-300">
                    <ShieldCheck className="h-3.5 w-3.5 text-sky-300/80" />
                    Control
                  </div>
                  <div className="mt-2 text-sm text-slate-100">Browser activation, SAFE mode, and local custody</div>
                </div>
              </div>
            </div>

            <div className="mt-8 flex items-center justify-between border-t border-slate-800/90 pt-6">
            <div className="space-y-1">
              <div className="text-sm text-slate-200">
                  {isAuthenticated ? 'Desktop access is available.' : isHostedMode ? 'Browser activation is ready for desktop unlock.' : 'Local desktop access is ready.'}
                </div>
                <div className="text-xs text-slate-300">
                  {isHostedMode ? 'Launch mode: browser activation + local-first runtime' : 'Launch mode: local-first desktop runtime'}
                </div>
              </div>
              <button
                type="button"
                data-entry-option="thredos"
                onClick={() => handleEnter(primaryHref, onEnterThredOS, onEnterThreadOS)}
                className={cn(buttonVariants({ variant: 'default' }), 'group-hover:border-sky-300/70')}
              >
                {primaryLabel}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex h-full flex-col justify-between overflow-hidden border border-slate-800/90 bg-[#08101d] p-8 shadow-[0_28px_80px_rgba(0,0,0,0.45)]">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <span className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-4 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-emerald-100">
                  Local-first posture
                </span>
                <ShieldCheck className="h-5 w-5 text-emerald-300" />
              </div>
              <div className="space-y-3">
                <h2 className="text-3xl font-light tracking-[-0.04em] text-white">Publicly purchasable, locally retained</h2>
                <p className="text-sm leading-7 text-slate-300">
                  The launch path is self-serve desktop activation with local workspace custody.
                  That keeps the product revenue-capable without turning thredOS into a hosted
                  workspace product.
                </p>
              </div>
              <div className="space-y-3 border border-emerald-500/25 bg-emerald-500/5 px-5 py-5">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-300/70">Included now</div>
                <ul className="space-y-2 text-sm text-slate-200">
                  <li>thredOS Desktop launch path</li>
                  <li>Tiered thread surfaces and lineage views</li>
                  <li>Activation, agent registry, and local-first workspace custody</li>
                </ul>
              </div>
              <div className="space-y-3 border border-slate-800/90 bg-[#08111f] px-5 py-5">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-300">Held back</div>
                <ul className="space-y-2 text-sm text-slate-300">
                  <li>Thread Runner remains a separate cloud proving layer</li>
                  <li>thredOS Node follows after Desktop launch</li>
                  <li>Unsafe chat apply and shell execution stay restricted</li>
                </ul>
              </div>
            </div>

            <div className="mt-8 flex items-center justify-between border-t border-slate-800/90 pt-6">
              <span className="text-sm text-slate-400">Commercial path: self-serve paid desktop activation with private local workspaces</span>
              <span className={cn(buttonVariants({ variant: 'outline' }))}>
                Desktop beta
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

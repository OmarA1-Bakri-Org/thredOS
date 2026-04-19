'use client'

import { ArrowRight, Library, Network, ShieldCheck, Sparkles } from 'lucide-react'
import { PreviewVariantBadge } from '@/components/design/PreviewVariantBadge'
import { ThredOSBrand } from '@/components/brand/ThredOSBrand'
import { buttonVariants } from '@/components/ui/button'
import { Panel } from '@/components/ui/panel'
import { TopologyPulse } from '@/components/entry/topology-pulse'
import { getUiVariantTheme, type UiVariant } from '@/lib/ui/design-variants'
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

function DesktopSurfaceDiagram({ uiVariant }: { uiVariant: UiVariant }) {
  const theme = getUiVariantTheme(uiVariant)

  return (
    <div className={cn('relative overflow-hidden px-5 py-5', theme.entry.diagramFrame)}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.16),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(14,165,233,0.12),transparent_34%)]" />
      <div className="relative space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className={cn('font-mono text-[10px] uppercase tracking-[0.22em]', theme.entry.diagramAccentText)}>Desktop topology</div>
            <div className="mt-1 text-sm text-slate-300">Local workspace, tiered surfaces, and a narrow cloud boundary.</div>
          </div>
          <span className={cn('rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em]', theme.entry.diagramBadge)}>
            local-first
          </span>
        </div>

        <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr]">
          <div className={cn('space-y-3 px-4 py-4', theme.entry.diagramPanel)}>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">On your machine</div>
            <div className="grid gap-2">
              <div className="border border-sky-500/25 bg-sky-500/8 px-3 py-2 text-sm text-slate-100">workspace</div>
              <div className="border border-slate-800 bg-[#0a1524] px-3 py-2 text-sm text-slate-200">prompts + skills</div>
              <div className="border border-slate-800 bg-[#0a1524] px-3 py-2 text-sm text-slate-200">sequence + surfaces</div>
              <div className="border border-slate-800 bg-[#0a1524] px-3 py-2 text-sm text-slate-200">runs + artifacts</div>
            </div>
          </div>

          <div className="flex items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <TopologyPulse direction="down" />
              <div className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-emerald-100">
                account/entitlement & canonical registration only
              </div>
              <TopologyPulse direction="down" delay={1.2} />
            </div>
          </div>

          <div className={cn('space-y-3 px-4 py-4', theme.entry.diagramPanel)}>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">Cloud boundary</div>
            <div className="grid gap-2">
              <div className="border border-emerald-500/25 bg-emerald-500/8 px-3 py-2 text-sm text-slate-100">billing + auth</div>
              <div className="border border-emerald-500/25 bg-emerald-500/8 px-3 py-2 text-sm text-slate-100">activation state</div>
              <div className="border border-emerald-500/25 bg-emerald-500/8 px-3 py-2 text-sm text-slate-100">canonical agent registry</div>
              <div className="border border-emerald-500/25 bg-emerald-500/8 px-3 py-2 text-sm text-slate-100">account/entitlement only</div>
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className={cn('px-4 py-3', theme.entry.diagramPanel)}>
            <div className={cn('font-mono text-[10px] uppercase tracking-[0.18em]', theme.entry.diagramAccentText)}>surface 0</div>
            <div className="mt-2 text-sm text-slate-100">orchestrator / parent agent</div>
          </div>
          <div className={cn('px-4 py-3', theme.entry.diagramPanel)}>
            <div className={cn('font-mono text-[10px] uppercase tracking-[0.18em]', theme.entry.diagramAccentText)}>surface 1</div>
            <div className="mt-2 text-sm text-slate-100">spawned child agents</div>
          </div>
          <div className={cn('px-4 py-3', theme.entry.diagramPanel)}>
            <div className={cn('font-mono text-[10px] uppercase tracking-[0.18em]', theme.entry.diagramAccentText)}>surface 2</div>
            <div className="mt-2 text-sm text-slate-100">deeper delegated work</div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ProductEntryScreenClient({
  isHostedMode = false,
  isAuthenticated = false,
  primaryHref,
  onEnterThredOS,
  onEnterThreadOS,
  uiVariant = 'operator-minimalism',
  previewMode = false,
}: ProductEntryScreenProps) {
  const theme = getUiVariantTheme(uiVariant)
  const primaryLabel = isAuthenticated ? 'Open Desktop Surface' : isHostedMode ? 'Activate Desktop' : 'Open thredOS'

  return (
    <main data-ui-variant={uiVariant} data-ui-preview={previewMode ? 'true' : 'false'} className={cn('flex min-h-screen text-slate-100', theme.entry.root)}>
      <div className="m-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-12">
        <Panel
          padding="none"
          elevation="overlay"
          themeClassName={theme.entry.hero}
          className="space-y-4 px-8 py-8"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <ThredOSBrand
              priority
              subtitle="Desktop public beta"
              imageClassName="h-16 w-16 translate-y-[7px]"
              labelClassName="pb-[2px]"
              className="items-end gap-5"
            />
            <PreviewVariantBadge uiVariant={uiVariant} previewMode={previewMode} />
          </div>
          <div className="space-y-3">
            <h1 className="max-w-4xl text-5xl font-light tracking-[-0.04em] text-white">
              Local-first control for agent work, with your workspace staying yours.
            </h1>
            <p className="max-w-3xl text-sm leading-7 text-slate-300">
              thredOS Desktop keeps prompts, skills, threads, surfaces, runs, and artifacts on
              your machine. The cloud is used only for activation, billing, and canonical agent
              registration.
            </p>
          </div>
        </Panel>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.18fr)_minmax(0,0.82fr)]">
          <Panel
            data-entry-option="thredos"
            padding="none"
            elevation="overlay"
            themeClassName={theme.entry.primaryPanel}
            className="group flex h-full flex-col justify-between p-8 text-left"
          >
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <span className={cn(
                  'rounded-full px-4 py-1 font-mono text-[11px] uppercase tracking-[0.18em]',
                  previewMode
                    ? theme.entry.previewBadge
                    : 'border border-sky-500/35 bg-sky-500/10 text-sky-100',
                )}>
                  {previewMode ? theme.label : 'thredOS Desktop'}
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
                <Panel tone="none" padding="md" themeClassName={theme.entry.diagramPanel}>
                  <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-300">
                    <Library className="h-3.5 w-3.5 text-sky-300/80" />
                    Library
                  </div>
                  <div className="mt-2 text-sm text-slate-100">Local prompts, local skills, canonical agents</div>
                </Panel>
                <Panel tone="none" padding="md" themeClassName={theme.entry.diagramPanel}>
                  <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-300">
                    <Sparkles className="h-3.5 w-3.5 text-sky-300/80" />
                    Surfaces
                  </div>
                  <div className="mt-2 text-sm text-slate-100">Tiered parent and child execution planes</div>
                </Panel>
                <Panel tone="none" padding="md" themeClassName={theme.entry.diagramPanel}>
                  <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-300">
                    <ShieldCheck className="h-3.5 w-3.5 text-sky-300/80" />
                    Control
                  </div>
                  <div className="mt-2 text-sm text-slate-100">Browser activation, SAFE mode, and local custody</div>
                </Panel>
              </div>
              <DesktopSurfaceDiagram uiVariant={uiVariant} />
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
                data-testid="entry-primary-thredos"
                onClick={() => handleEnter(primaryHref, onEnterThredOS, onEnterThreadOS)}
                className={cn(buttonVariants({ variant: 'default' }), 'group-hover:border-sky-300/70')}
              >
                {primaryLabel}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </Panel>

          <Panel
            padding="none"
            elevation="overlay"
            themeClassName={theme.entry.secondaryPanel}
            className="flex h-full flex-col justify-between overflow-hidden p-8"
          >
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
              <Panel
                tone="emerald"
                padding="lg"
                className="space-y-3"
              >
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-300/70">Included now</div>
                <ul className="space-y-2 text-sm text-slate-200">
                  <li>thredOS Desktop launch path</li>
                  <li>Tiered thread surfaces and lineage views</li>
                  <li>Activation, agent registry, and local-first workspace custody</li>
                </ul>
              </Panel>
              <Panel
                tone="none"
                padding="lg"
                themeClassName={theme.entry.diagramPanel}
                className="space-y-3"
              >
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-300">Held back</div>
                <ul className="space-y-2 text-sm text-slate-300">
                  <li>Thread Runner remains a separate cloud proving layer</li>
                  <li>thredOS Node follows after Desktop launch</li>
                  <li>Unsafe chat apply and shell execution stay restricted</li>
                </ul>
              </Panel>
            </div>

            <div className="mt-8 flex items-center justify-between border-t border-slate-800/90 pt-6">
              <span className="text-sm text-slate-400">Commercial path: self-serve paid desktop activation with private local workspaces</span>
              <span className={cn(buttonVariants({ variant: 'outline' }))}>
                Desktop beta
              </span>
            </div>
          </Panel>
        </div>
      </div>
    </main>
  )
}

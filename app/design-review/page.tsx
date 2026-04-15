import Link from 'next/link'
import { ArrowRight, Lock, MonitorSmartphone, Sparkles } from 'lucide-react'
import { PreviewVariantBadge } from '@/components/design/PreviewVariantBadge'
import { ThredOSBrand } from '@/components/brand/ThredOSBrand'
import {
  UI_VARIANT_OPTIONS,
  buildEntryPreviewHref,
  buildLoginPreviewHref,
  buildWorkbenchPreviewHref,
  getUiVariantTheme,
} from '@/lib/ui/design-variants'

export default function DesignReviewPage() {
  return (
    <div className="min-h-screen bg-[#060a12] px-6 py-10 text-slate-100">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <div className="border border-slate-800/90 bg-[#08101d] px-8 py-8 shadow-[0_28px_80px_rgba(0,0,0,0.45)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <ThredOSBrand subtitle="Concept review gate" priority className="items-end" imageClassName="h-16 w-16" />
            <span className="rounded-full border border-rose-500/35 bg-rose-500/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-rose-100">
              Hard gate — choose one before rollout
            </span>
          </div>
          <h1 className="mt-5 max-w-4xl text-5xl font-light tracking-[-0.05em] text-white">
            Review three serious desktop directions before the production UI pass lands.
          </h1>
          <p className="mt-5 max-w-3xl text-sm leading-7 text-slate-300">
            Each option keeps the same product content and local-first trust posture. Only the visual treatment changes. The next step is an explicit user choice, not an automatic rollout.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {UI_VARIANT_OPTIONS.map(option => {
            const theme = getUiVariantTheme(option.id)
            return (
              <section
                key={option.id}
                data-testid={`design-review-card-${option.id}`}
                className={`flex flex-col justify-between border px-6 py-6 shadow-[0_24px_60px_rgba(0,0,0,0.35)] ${theme.entry.primaryPanel}`}
              >
                <div className="space-y-5">
                  <div className="flex items-center justify-between gap-3">
                    <PreviewVariantBadge uiVariant={option.id} previewMode tone="entry" />
                    <Sparkles className="h-4 w-4 text-slate-400" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-semibold tracking-tight text-white">{option.label}</h2>
                    <p className="mt-3 text-sm leading-7 text-slate-300">{option.summary}</p>
                  </div>
                  <div className="grid gap-3 border border-slate-800 bg-[#08111f] px-4 py-4 text-sm text-slate-200">
                    <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
                      <MonitorSmartphone className="h-3.5 w-3.5" />
                      Included preview surfaces
                    </div>
                    <ul className="space-y-2">
                      <li>Public entry / landing surface</li>
                      <li>Hosted login / activation shell</li>
                      <li>Authenticated workbench shell and header</li>
                    </ul>
                  </div>
                </div>

                <div className="mt-8 space-y-3 border-t border-slate-800/80 pt-5">
                  <Link href={buildEntryPreviewHref(option.id)} className="flex items-center justify-between border border-slate-700 bg-[#08111f] px-4 py-3 text-sm text-slate-100 transition-colors hover:border-slate-500 hover:text-white">
                    <span>Preview entry</span>
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link href={buildLoginPreviewHref(option.id)} className="flex items-center justify-between border border-slate-700 bg-[#08111f] px-4 py-3 text-sm text-slate-100 transition-colors hover:border-slate-500 hover:text-white">
                    <span>Preview login / activation</span>
                    <Lock className="h-4 w-4" />
                  </Link>
                  <Link href={buildWorkbenchPreviewHref(option.id)} className="flex items-center justify-between border border-slate-700 bg-[#08111f] px-4 py-3 text-sm text-slate-100 transition-colors hover:border-slate-500 hover:text-white">
                    <span>Preview workbench shell</span>
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}

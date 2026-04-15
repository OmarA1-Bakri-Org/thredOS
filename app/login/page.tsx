import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PreviewVariantBadge } from '@/components/design/PreviewVariantBadge'
import { LoginForm } from '@/components/auth/LoginForm'
import { ThredOSBrand } from '@/components/brand/ThredOSBrand'
import { getServerSession } from '@/lib/auth/session'
import { isHostedMode } from '@/lib/hosted'
import { getUiVariantTheme, resolvePreviewMode, resolveUiVariant, takeFirstQueryValue } from '@/lib/ui/design-variants'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  if (!isHostedMode()) {
    redirect('/app')
  }

  const session = await getServerSession()
  if (session) {
    redirect('/app')
  }

  const params = await searchParams
  const uiVariant = resolveUiVariant(takeFirstQueryValue(params.uiVariant))
  const previewMode = resolvePreviewMode(takeFirstQueryValue(params.preview))
  const theme = getUiVariantTheme(uiVariant)

  return (
    <div data-ui-variant={uiVariant} data-ui-preview={previewMode ? 'true' : 'false'} className={`flex min-h-screen text-slate-100 ${theme.auth.root}`}>
      <div className="m-auto grid w-full max-w-5xl gap-8 px-6 py-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(22rem,0.9fr)]">
        <div className={`${theme.auth.primaryPanel} px-8 py-8 shadow-[0_28px_80px_rgba(0,0,0,0.45)]`}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <ThredOSBrand
              priority
              subtitle="Desktop activation"
              className="items-end"
              imageClassName="h-20 w-20"
            />
            <PreviewVariantBadge uiVariant={uiVariant} previewMode={previewMode} tone="auth" />
          </div>
          <h1 className="mt-4 text-5xl font-light tracking-[-0.05em] text-white">
            Activate thredOS Desktop.
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-slate-300">
            Sign in here to unlock the paid local-first desktop product. Your workspace, prompts,
            skills, thread state, and artifacts stay on your machine. The cloud is used only for
            activation, billing, and canonical agent registration.
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <div className="border border-slate-800 bg-[#08111f] px-4 py-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Surface</div>
              <div className="mt-2 text-sm text-slate-100">Tiered local thread surfaces</div>
            </div>
            <div className="border border-slate-800 bg-[#08111f] px-4 py-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Assets</div>
              <div className="mt-2 text-sm text-slate-100">Local prompt and skill libraries</div>
            </div>
            <div className="border border-slate-800 bg-[#08111f] px-4 py-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Control</div>
              <div className="mt-2 text-sm text-slate-100">Browser activation and SAFE execution</div>
            </div>
          </div>
        </div>

        <div className={`${theme.auth.secondaryPanel} px-8 py-8 shadow-[0_28px_80px_rgba(0,0,0,0.45)]`}>
          <div className="mb-6">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-400">
              Sign in
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Desktop entitlement access</h2>
          </div>
          <LoginForm />
          <div className="mt-6 border-t border-slate-800 pt-5 text-sm text-slate-400">
            Need the launch overview first? Return to the <Link href={previewMode ? `/?uiVariant=${uiVariant}&preview=1` : '/'} className="text-sky-200 hover:text-white">desktop launch page</Link>.
          </div>
        </div>
      </div>
    </div>
  )
}

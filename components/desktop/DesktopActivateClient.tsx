'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { PreviewVariantBadge } from '@/components/design/PreviewVariantBadge'
import { type UiVariant, getUiVariantTheme } from '@/lib/ui/design-variants'
import { isClientVerificationMode } from '@/lib/verification/runtime'

type ActivationResolution =
  | { status: 'idle' | 'processing' }
  | { status: 'cancelled' }
  | { status: 'error'; error: string }
  | { status: 'ready'; deepLink: string; customerEmail: string | null; entitlementStatus: string }

export function DesktopActivateClient({
  uiVariant = 'operator-minimalism',
  previewMode = false,
}: {
  uiVariant?: UiVariant
  previewMode?: boolean
}) {
  const theme = getUiVariantTheme(uiVariant)
  const searchParams = useSearchParams()
  const verificationMode = isClientVerificationMode()
  const stateId = searchParams.get('state')
  const sessionId = searchParams.get('session_id')
  const cancelled = searchParams.get('status') === 'cancelled'
  const immediateResolution = cancelled
    ? { status: 'cancelled' } satisfies ActivationResolution
    : !stateId || !sessionId
      ? { status: 'error', error: 'Missing activation state or checkout session.' } satisfies ActivationResolution
      : null
  const [asyncResolution, setAsyncResolution] = useState<ActivationResolution | null>(null)
  const resolution = useMemo<ActivationResolution>(
    () => immediateResolution ?? asyncResolution ?? { status: 'processing' },
    [asyncResolution, immediateResolution],
  )

  useEffect(() => {
    if (immediateResolution || !stateId || !sessionId) return

    let active = true

    void fetch(`/api/desktop/checkout/resolve?state=${encodeURIComponent(stateId)}&session_id=${encodeURIComponent(sessionId)}`)
      .then(async response => {
        const body = await response.json().catch(() => ({ error: 'Unable to resolve activation' }))
        if (!active) return
        if (!response.ok) {
          setAsyncResolution({ status: 'error', error: body.error ?? 'Unable to resolve activation' })
          return
        }
        setAsyncResolution({
          status: 'ready',
          deepLink: body.deepLink,
          customerEmail: body.customerEmail ?? null,
          entitlementStatus: body.entitlementStatus ?? 'active',
        })
      })
      .catch(() => {
        if (active) {
          setAsyncResolution({ status: 'error', error: 'Unable to resolve activation right now.' })
        }
      })

    return () => {
      active = false
    }
  }, [immediateResolution, sessionId, stateId])

  useEffect(() => {
    if (resolution.status === 'ready' && !verificationMode) {
      window.location.assign(resolution.deepLink)
    }
  }, [resolution, verificationMode])

  return (
    <div data-testid="desktop-activate-page" data-ui-variant={uiVariant} data-ui-preview={previewMode ? 'true' : 'false'} className={`flex min-h-screen text-slate-100 ${theme.auth.root}`}>
      <div className={`${theme.auth.primaryPanel} m-auto w-full max-w-2xl px-8 py-10 shadow-[0_28px_80px_rgba(0,0,0,0.45)]`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.28em] text-sky-300/60">Desktop activation return</div>
            <h1 className="mt-4 text-4xl font-light tracking-[-0.04em] text-white">Finish activating thredOS Desktop.</h1>
          </div>
          <PreviewVariantBadge uiVariant={uiVariant} previewMode={previewMode} tone="auth" />
        </div>

        {resolution.status === 'processing' || resolution.status === 'idle' ? (
          <p data-testid="desktop-activate-processing" className="mt-5 text-sm leading-7 text-slate-300">
            Confirming your checkout and preparing the local activation token now.
          </p>
        ) : null}

        {resolution.status === 'cancelled' ? (
          <p data-testid="desktop-activate-cancelled" className="mt-5 text-sm leading-7 text-slate-300">
            Checkout was cancelled. You can close this tab and start the browser activation flow again from thredOS Desktop.
          </p>
        ) : null}

        {resolution.status === 'error' ? (
          <div data-testid="desktop-activate-error" className="mt-6 border border-rose-500/35 bg-rose-500/10 px-4 py-4 text-sm text-rose-100">
            {resolution.error}
          </div>
        ) : null}

        {resolution.status === 'ready' ? (
          <div data-testid="desktop-activate-ready" className="mt-6 space-y-4">
            <div className="border border-emerald-500/35 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-100">
              Activation is ready{resolution.customerEmail ? ` for ${resolution.customerEmail}` : ''}. If thredOS Desktop did not reopen automatically, use the button below.
            </div>
            {verificationMode ? (
              <div className="border border-sky-500/35 bg-sky-500/10 px-4 py-4 text-sm text-sky-100">
                Verification mode keeps the desktop deep-link visible instead of auto-opening it.
              </div>
            ) : null}
            <a
              data-testid="desktop-activate-open-desktop"
              href={resolution.deepLink}
              className="inline-flex items-center justify-center border border-sky-500/40 bg-sky-500/10 px-5 py-3 text-sm font-medium text-sky-100 transition-colors hover:border-sky-300/60 hover:text-white"
            >
              Open thredOS Desktop
            </a>
            <div className="text-xs text-slate-400">
              Entitlement state: <span className="text-slate-200">{resolution.entitlementStatus}</span>
            </div>
          </div>
        ) : null}

        <div className="mt-8 border-t border-slate-800 pt-5 text-sm text-slate-400">
          Need to restart the flow? Return to the <Link href={previewMode ? `/?uiVariant=${uiVariant}&preview=1` : '/'} className="text-sky-200 hover:text-white">launch surface</Link>.
        </div>
      </div>
    </div>
  )
}

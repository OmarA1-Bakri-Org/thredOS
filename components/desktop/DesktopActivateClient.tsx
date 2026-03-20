'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

type ActivationResolution =
  | { status: 'idle' | 'processing' }
  | { status: 'cancelled' }
  | { status: 'error'; error: string }
  | { status: 'ready'; deepLink: string; customerEmail: string | null; entitlementStatus: string }

export function DesktopActivateClient() {
  const searchParams = useSearchParams()
  const [resolution, setResolution] = useState<ActivationResolution>({ status: 'idle' })
  const stateId = searchParams.get('state')
  const sessionId = searchParams.get('session_id')
  const cancelled = searchParams.get('status') === 'cancelled'

  useEffect(() => {
    if (cancelled) {
      setResolution({ status: 'cancelled' })
      return
    }
    if (!stateId || !sessionId) {
      setResolution({ status: 'error', error: 'Missing activation state or checkout session.' })
      return
    }

    let active = true
    setResolution({ status: 'processing' })

    void fetch(`/api/desktop/checkout/resolve?state=${encodeURIComponent(stateId)}&session_id=${encodeURIComponent(sessionId)}`)
      .then(async response => {
        const body = await response.json().catch(() => ({ error: 'Unable to resolve activation' }))
        if (!active) return
        if (!response.ok) {
          setResolution({ status: 'error', error: body.error ?? 'Unable to resolve activation' })
          return
        }
        setResolution({
          status: 'ready',
          deepLink: body.deepLink,
          customerEmail: body.customerEmail ?? null,
          entitlementStatus: body.entitlementStatus ?? 'active',
        })
      })
      .catch(() => {
        if (active) {
          setResolution({ status: 'error', error: 'Unable to resolve activation right now.' })
        }
      })

    return () => {
      active = false
    }
  }, [cancelled, sessionId, stateId])

  useEffect(() => {
    if (resolution.status === 'ready') {
      window.location.assign(resolution.deepLink)
    }
  }, [resolution])

  return (
    <div className="flex min-h-screen bg-[#060a12] text-slate-100">
      <div className="m-auto w-full max-w-2xl border border-slate-800/90 bg-[#08101d] px-8 py-10 shadow-[0_28px_80px_rgba(0,0,0,0.45)]">
        <div className="font-mono text-[11px] uppercase tracking-[0.28em] text-sky-300/60">Desktop activation return</div>
        <h1 className="mt-4 text-4xl font-light tracking-[-0.04em] text-white">Finish activating thredOS Desktop.</h1>

        {resolution.status === 'processing' || resolution.status === 'idle' ? (
          <p className="mt-5 text-sm leading-7 text-slate-300">
            Confirming your checkout and preparing the local activation token now.
          </p>
        ) : null}

        {resolution.status === 'cancelled' ? (
          <p className="mt-5 text-sm leading-7 text-slate-300">
            Checkout was cancelled. You can close this tab and start the browser activation flow again from thredOS Desktop.
          </p>
        ) : null}

        {resolution.status === 'error' ? (
          <div className="mt-6 border border-rose-500/35 bg-rose-500/10 px-4 py-4 text-sm text-rose-100">
            {resolution.error}
          </div>
        ) : null}

        {resolution.status === 'ready' ? (
          <div className="mt-6 space-y-4">
            <div className="border border-emerald-500/35 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-100">
              Activation is ready{resolution.customerEmail ? ` for ${resolution.customerEmail}` : ''}. If thredOS Desktop did not reopen automatically, use the button below.
            </div>
            <a
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
          Need to restart the flow? Return to the <Link href="/" className="text-sky-200 hover:text-white">launch surface</Link>.
        </div>
      </div>
    </div>
  )
}

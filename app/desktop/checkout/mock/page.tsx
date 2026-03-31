import Link from 'next/link'
import { notFound } from 'next/navigation'
import { isVerificationMode } from '@/lib/verification/runtime'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function takeFirst(value: string | string[] | undefined, fallback = ''): string {
  return Array.isArray(value) ? value[0] ?? fallback : value ?? fallback
}

export default async function MockDesktopCheckoutPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  if (!isVerificationMode()) {
    notFound()
  }

  const params = await searchParams
  const state = takeFirst(params.state)
  const sessionId = takeFirst(params.session_id)
  const email = takeFirst(params.email, 'verifier@thredos.local')
  const plan = takeFirst(params.plan, 'desktop-public-beta')

  const successHref = `/desktop/activate?state=${encodeURIComponent(state)}&session_id=${encodeURIComponent(sessionId)}`
  const cancelHref = `/desktop/activate?state=${encodeURIComponent(state)}&status=cancelled`

  return (
    <div className="flex min-h-screen bg-[#060a12] text-slate-100">
      <div className="m-auto w-full max-w-2xl border border-slate-800/90 bg-[#08101d] px-8 py-10 shadow-[0_28px_80px_rgba(0,0,0,0.45)]">
        <div className="font-mono text-[11px] uppercase tracking-[0.28em] text-sky-300/60">Verification checkout</div>
        <h1 className="mt-4 text-4xl font-light tracking-[-0.04em] text-white">
          thredOS Desktop Public Beta
        </h1>
        <p className="mt-5 text-sm leading-7 text-slate-300">
          This stub checkout page exists only for deterministic browser verification. It preserves the browser return flow without requiring a live Stripe session in local or CI runs.
        </p>

        <div className="mt-6 grid gap-3 border border-slate-800 bg-[#060e1a] px-4 py-4 text-sm text-slate-200">
          <div>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Plan</span>
            <div data-testid="verification-checkout-plan" className="mt-1">{plan}</div>
          </div>
          <div>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Customer</span>
            <div data-testid="verification-checkout-email" className="mt-1">{email}</div>
          </div>
          <div>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Session</span>
            <div data-testid="verification-checkout-session" className="mt-1 font-mono text-xs text-slate-300">{sessionId}</div>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            data-testid="verification-checkout-complete"
            href={successHref}
            className="inline-flex items-center justify-center border border-emerald-500/40 bg-emerald-500/10 px-5 py-3 text-sm font-medium text-emerald-100 transition-colors hover:border-emerald-300/60 hover:text-white"
          >
            Complete verification checkout
          </Link>
          <Link
            data-testid="verification-checkout-cancel"
            href={cancelHref}
            className="inline-flex items-center justify-center border border-slate-700 bg-slate-950/60 px-5 py-3 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
          >
            Cancel checkout
          </Link>
        </div>
      </div>
    </div>
  )
}

'use client'

import { FormEvent, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'

function sanitizeNextPath(value: string | null): string {
  if (!value || !value.startsWith('/')) return '/app'
  if (value.startsWith('//')) return '/app'
  return value
}

export function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const nextPath = useMemo(() => sanitizeNextPath(searchParams.get('next')), [searchParams])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, next: nextPath }),
      })
      const body = await response.json().catch(() => ({ error: 'Unable to sign in' }))
      if (!response.ok) {
        setError(body.error ?? 'Unable to sign in')
        return
      }
      router.replace(body.redirectTo ?? nextPath)
      router.refresh()
    } catch {
      setError('Unable to sign in right now')
    } finally {
      setPending(false)
    }
  }

  return (
    <form data-testid="login-form" onSubmit={handleSubmit} className="space-y-5">
      <label className="block space-y-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-400">Email</span>
        <input
          data-testid="login-email"
          type="email"
          value={email}
          onChange={event => setEmail(event.target.value)}
          placeholder="you@company.com"
          className="w-full border border-slate-700 bg-[#08101d] px-4 py-3 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-500 focus:border-sky-400"
          autoComplete="username"
          required
        />
      </label>

      <label className="block space-y-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-400">Password</span>
        <input
          data-testid="login-password"
          type="password"
          value={password}
          onChange={event => setPassword(event.target.value)}
          placeholder="Your admin password"
          className="w-full border border-slate-700 bg-[#08101d] px-4 py-3 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-500 focus:border-sky-400"
          autoComplete="current-password"
          required
        />
      </label>

      {error ? (
        <div data-testid="login-error" className="border border-rose-500/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      <Button data-testid="login-submit" type="submit" variant="default" className="w-full justify-center" disabled={pending}>
        {pending ? 'Signing in' : 'Enter thredOS'}
      </Button>
    </form>
  )
}

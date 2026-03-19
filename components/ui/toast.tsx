'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

/* ── Types ────────────────────────────────────────────── */

type ToastVariant = 'default' | 'success' | 'error' | 'warning'

interface ToastPayload {
  title: string
  description?: string
  variant?: ToastVariant
}

interface ToastEntry extends ToastPayload {
  id: string
  exiting: boolean
}

interface ToastContextValue {
  toast: (payload: ToastPayload) => void
}

/* ── Variant styles (mirrors button CVA palette) ─────── */

const variantStyles: Record<ToastVariant, string> = {
  default:
    'border-sky-500/45 bg-sky-500/10 text-sky-100',
  success:
    'border-emerald-500/45 bg-emerald-500/10 text-emerald-100',
  error:
    'border-rose-500/45 bg-rose-500/10 text-rose-100',
  warning:
    'border-amber-500/45 bg-amber-500/10 text-amber-100',
}

/* ── Context ──────────────────────────────────────────── */

const ToastContext = createContext<ToastContextValue | null>(null)

/* ── Provider ─────────────────────────────────────────── */

const AUTO_DISMISS_MS = 4000
const EXIT_ANIMATION_MS = 300

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([])
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  /* Cleanup all timers on unmount */
  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach((t) => clearTimeout(t))
    }
  }, [])

  const dismiss = useCallback((id: string) => {
    /* Start exit animation */
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)))

    /* Remove from DOM after animation completes */
    const exitTimer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
      timersRef.current.delete(id)
    }, EXIT_ANIMATION_MS)

    timersRef.current.set(`${id}-exit`, exitTimer)
  }, [])

  const toast = useCallback(
    (payload: ToastPayload) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const entry: ToastEntry = { ...payload, id, exiting: false }
      setToasts((prev) => [...prev, entry])

      /* Auto-dismiss */
      const timer = setTimeout(() => dismiss(id), AUTO_DISMISS_MS)
      timersRef.current.set(id, timer)
    },
    [dismiss],
  )

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}

      {/* ── Toast container (fixed bottom-right) ── */}
      <div
        role="region"
        aria-live="polite"
        aria-label="Notifications"
        className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2"
      >
        {toasts.map((t) => {
          const variant = t.variant ?? 'default'
          return (
            <div
              key={t.id}
              role="status"
              className={[
                'pointer-events-auto w-80 border px-4 py-3 shadow-lg backdrop-blur-sm',
                'transition-all duration-300 ease-out',
                t.exiting
                  ? 'translate-x-full opacity-0'
                  : 'translate-x-0 opacity-100 animate-in slide-in-from-right-full',
                variantStyles[variant],
              ].join(' ')}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[11px] uppercase tracking-[0.18em]">
                    {t.title}
                  </p>
                  {t.description && (
                    <p className="mt-1 text-xs leading-5 text-slate-300">{t.description}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(t.id)}
                  className="shrink-0 text-slate-500 transition-colors hover:text-slate-300"
                  aria-label="Dismiss notification"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

/* ── Hook ─────────────────────────────────────────────── */

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used within a <ToastProvider>')
  }
  return ctx
}

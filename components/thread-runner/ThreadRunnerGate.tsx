'use client'

import { LockKeyhole, ShieldCheck, Trophy, Cpu } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Requirement {
  label: string
  description: string
  unlocked: boolean
  icon: React.ReactNode
}

const requirements: Requirement[] = [
  {
    label: 'Verified Identity',
    description: 'A verified ThreadOS identity linked to your account.',
    unlocked: false,
    icon: <ShieldCheck className="h-4 w-4" />,
  },
  {
    label: 'VM Access',
    description: 'Managed VM runtime for sandboxed execution environments.',
    unlocked: false,
    icon: <Cpu className="h-4 w-4" />,
  },
  {
    label: 'Active Subscription',
    description: 'An active paid subscription to the Thread Runner tier.',
    unlocked: false,
    icon: <LockKeyhole className="h-4 w-4" />,
  },
]

export function ThreadRunnerGate() {
  return (
    <div data-testid="thread-runner-gate" className="flex h-full items-center justify-center bg-[#060a12]">
      <div className="flex w-full max-w-md flex-col items-center gap-6 px-6 py-12">
        <div className="flex h-14 w-14 items-center justify-center border border-amber-500/35 bg-amber-500/10">
          <Trophy className="h-7 w-7 text-amber-300" />
        </div>

        <div className="space-y-2 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-white">Thread Runner</h2>
          <p className="text-sm leading-6 text-slate-400">
            The locked proving layer for verified competitive runs. Meet all requirements below to unlock entry.
          </p>
        </div>

        <div data-testid="thread-runner-requirements" className="w-full space-y-3">
          {requirements.map(req => (
            <div
              key={req.label}
              data-testid={`requirement-${req.label.toLowerCase().replace(/\s+/g, '-')}`}
              className="flex items-start gap-4 border border-slate-800/90 bg-[#08101d] px-5 py-4"
            >
              <div
                className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center border ${
                  req.unlocked
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                    : 'border-slate-700 bg-slate-900 text-slate-500'
                }`}
              >
                {req.icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-200">
                    {req.label}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] ${
                      req.unlocked
                        ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                        : 'border border-slate-700 bg-slate-900 text-slate-500'
                    }`}
                  >
                    {req.unlocked ? 'Unlocked' : 'Locked'}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-500">{req.description}</p>
              </div>
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="warning"
          disabled
          className="w-full"
          data-testid="check-eligibility-btn"
        >
          Check Eligibility
        </Button>

        <p className="text-center font-mono text-[10px] uppercase tracking-[0.22em] text-slate-600">
          Thread Runner access is gated by verified eligibility
        </p>
      </div>
    </div>
  )
}

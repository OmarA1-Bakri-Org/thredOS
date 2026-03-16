'use client'

import { User, Bot, Package, Trophy, Activity } from 'lucide-react'
import { useBuilderProfile } from '@/lib/ui/api'
import type { BuilderProfile } from '@/lib/builders/types'

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="border border-slate-800 bg-[#0a101a] px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className="text-slate-600">{icon}</span>
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-600">{label}</span>
      </div>
      <div className="mt-1 text-lg font-semibold text-white">{value}</div>
    </div>
  )
}

function BuilderCard({ profile }: { profile: BuilderProfile }) {
  return (
    <div data-testid="builder-card" className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center border border-slate-700 bg-slate-900">
          <User className="h-5 w-5 text-slate-400" />
        </div>
        <div>
          <div className="font-mono text-sm text-white">{profile.name}</div>
          <div className="font-mono text-[10px] text-slate-500">ID: {profile.id}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <StatCard
          icon={<Bot className="h-3 w-3" />}
          label="Agents"
          value={String(profile.stats.totalAgents)}
        />
        <StatCard
          icon={<Package className="h-3 w-3" />}
          label="Packs"
          value={String(profile.stats.totalPacks)}
        />
        <StatCard
          icon={<Trophy className="h-3 w-3" />}
          label="Best Pack"
          value={profile.stats.highestPackStatus ?? '—'}
        />
        <StatCard
          icon={<Activity className="h-3 w-3" />}
          label="Quality"
          value={profile.stats.avgQuality > 0 ? `${profile.stats.avgQuality}/10` : '—'}
        />
      </div>
    </div>
  )
}

export function BuilderSection({ builderId }: { builderId: string | null }) {
  const { data: profile, isLoading } = useBuilderProfile(builderId)

  return (
    <div data-testid="builder-section" className="space-y-3 px-3 py-3">
      <div className="flex items-center gap-2">
        <User className="h-4 w-4 text-slate-500" />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
          Builder
        </span>
      </div>

      {isLoading && (
        <div className="text-center text-xs text-slate-600">Loading builder profile...</div>
      )}

      {!isLoading && !profile && (
        <div className="border border-dashed border-slate-800 px-3 py-4 text-center">
          <div className="text-sm text-slate-500">No builder selected</div>
          <div className="mt-1 text-xs text-slate-600">
            Register an agent with a builder identity to see the profile.
          </div>
        </div>
      )}

      {profile && <BuilderCard profile={profile} />}
    </div>
  )
}

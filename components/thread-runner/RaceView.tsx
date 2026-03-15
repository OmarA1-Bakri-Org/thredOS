'use client'

import { Flag, Timer, Medal, Users } from 'lucide-react'
import { useListRaces, useRaceResults } from '@/lib/ui/api'
import { useState } from 'react'
import type { Race } from '@/lib/thread-runner/types'

const STATUS_COLOR: Record<Race['status'], string> = {
  open: 'text-blue-400 border-blue-500/30 bg-blue-500/10',
  running: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  completed: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  cancelled: 'text-red-400 border-red-500/30 bg-red-500/10',
}

function RaceCard({ race, onSelect, selected }: { race: Race; onSelect: () => void; selected: boolean }) {
  return (
    <button
      type="button"
      data-testid={`race-card-${race.id}`}
      onClick={onSelect}
      className={`w-full border px-4 py-3 text-left transition-colors ${
        selected
          ? 'border-amber-500/40 bg-amber-500/5'
          : 'border-slate-800 bg-[#0a101a] hover:border-slate-700'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flag className="h-3.5 w-3.5 text-slate-500" />
          <span className="font-mono text-[11px] text-slate-200">{race.name}</span>
        </div>
        <span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase ${STATUS_COLOR[race.status]}`}>
          {race.status}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-3 text-[10px] text-slate-500">
        <span>{race.division}</span>
        <span className="text-slate-700">|</span>
        <span className="flex items-center gap-1">
          <Users className="h-3 w-3" />
          {race.combatantRunIds.length}/{race.maxCombatants}
        </span>
      </div>
    </button>
  )
}

function ResultsPanel({ raceId }: { raceId: string }) {
  const { data: results, isLoading } = useRaceResults(raceId)

  if (isLoading) {
    return <div className="py-4 text-center text-xs text-slate-600">Loading results...</div>
  }

  if (!results || results.placements.length === 0) {
    return (
      <div className="border border-dashed border-slate-800 px-3 py-4 text-center text-xs text-slate-500">
        No completed runs yet. Results appear as combatants finish.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-600">Results</div>
      {results.placements.map((p, i) => (
        <div key={p.combatantRunId} className="flex items-center gap-3 border border-slate-800 bg-[#0a101a] px-3 py-2">
          <div className={`flex h-6 w-6 items-center justify-center rounded-full border font-mono text-[10px] font-bold ${
            i === 0 ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
            : i <= 2 ? 'border-slate-600 bg-slate-800 text-slate-300'
            : 'border-slate-700 bg-slate-900 text-slate-500'
          }`}>
            {p.placement}
          </div>
          <div className="flex-1">
            <div className="font-mono text-[11px] text-slate-200">{p.combatantId}</div>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-slate-500">
            <Timer className="h-3 w-3" />
            {p.time > 0 ? `${(p.time / 1000).toFixed(1)}s` : '\u2014'}
          </div>
        </div>
      ))}
    </div>
  )
}

export function RaceView() {
  const { data: races, isLoading } = useListRaces()
  const [selectedRaceId, setSelectedRaceId] = useState<string | null>(null)

  return (
    <div data-testid="race-view" className="space-y-4 px-4 py-4">
      <div className="flex items-center gap-2">
        <Medal className="h-4 w-4 text-amber-400" />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
          Races
        </span>
        {races && (
          <span className="font-mono text-[9px] text-slate-600">({races.length})</span>
        )}
      </div>

      {isLoading && (
        <div className="py-4 text-center text-xs text-slate-600">Loading races...</div>
      )}

      {!isLoading && (!races || races.length === 0) && (
        <div className="border border-dashed border-slate-800 px-3 py-6 text-center">
          <Medal className="mx-auto h-8 w-8 text-slate-700" />
          <div className="mt-2 text-sm text-slate-500">No races yet</div>
          <div className="mt-1 text-xs text-slate-600">
            Races are created when agents compete in Thread Runner proving runs.
          </div>
        </div>
      )}

      <div className="space-y-2">
        {races?.map(race => (
          <RaceCard
            key={race.id}
            race={race}
            selected={selectedRaceId === race.id}
            onSelect={() => setSelectedRaceId(selectedRaceId === race.id ? null : race.id)}
          />
        ))}
      </div>

      {selectedRaceId && <ResultsPanel raceId={selectedRaceId} />}
    </div>
  )
}

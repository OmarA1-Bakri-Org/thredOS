'use client'

import { SkillBadgeRow, type SkillBadge } from './SkillBadgeRow'

interface SkillInventoryPanelProps {
  skills: SkillBadge[]
}

export function SkillInventoryPanel({ skills }: SkillInventoryPanelProps) {
  const inherited = skills.filter(s => s.inherited)
  const local = skills.filter(s => !s.inherited)

  return (
    <section data-testid="skill-inventory-panel" className="space-y-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Skills</div>

      {skills.length === 0 ? (
        <div
          data-testid="skill-inventory-empty"
          className="border border-dashed border-slate-800 px-3 py-4 text-sm text-slate-500"
        >
          No skills assigned to this surface.
        </div>
      ) : (
        <div className="space-y-3">
          {local.length > 0 && (
            <div data-testid="skill-group-local" className="space-y-1.5">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">Local</div>
              <SkillBadgeRow skills={local} />
            </div>
          )}
          {inherited.length > 0 && (
            <div data-testid="skill-group-inherited" className="space-y-1.5">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">Inherited</div>
              <SkillBadgeRow skills={inherited} />
            </div>
          )}
        </div>
      )}
    </section>
  )
}

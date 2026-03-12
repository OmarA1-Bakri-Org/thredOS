'use client'

import { Box, Bot, Folder, Globe, Search, ShieldCheck, Sparkles, Wrench } from 'lucide-react'

export interface SkillBadge {
  id: string
  label: string
  inherited: boolean
}

const skillIcons = {
  search: Search,
  browser: Globe,
  files: Folder,
  tools: Wrench,
  model: Bot,
  review: ShieldCheck,
  orchestration: Sparkles,
} as const

interface SkillBadgeRowProps {
  skills: SkillBadge[]
}

export function SkillBadgeRow({ skills }: SkillBadgeRowProps) {
  if (skills.length === 0) return null

  return (
    <div data-testid="skill-badge-row" className="flex flex-wrap gap-1.5">
      {skills.map(skill => {
        const Icon = skillIcons[skill.id as keyof typeof skillIcons] ?? Box
        return (
          <span
            key={`${skill.id}-${skill.label}`}
            data-testid={`skill-badge-${skill.id}`}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] ${
              skill.inherited
                ? 'border-slate-800 bg-slate-950/70 text-slate-500 opacity-60'
                : 'border-slate-700 bg-slate-900 text-slate-200'
            }`}
          >
            <Icon className="h-3 w-3" />
            {skill.label}
          </span>
        )
      })}
    </div>
  )
}

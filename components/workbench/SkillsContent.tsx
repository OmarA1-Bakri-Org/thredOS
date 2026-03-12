'use client'

import { SkillInventoryPanel } from '@/components/skills/SkillInventoryPanel'
import type { SkillBadge } from '@/components/skills/SkillBadgeRow'

const DEFAULT_SKILLS: SkillBadge[] = [
  { id: 'search', label: 'Search', inherited: false },
  { id: 'files', label: 'Files', inherited: false },
  { id: 'tools', label: 'Tools', inherited: false },
  { id: 'model', label: 'Model', inherited: true },
  { id: 'review', label: 'Review', inherited: true },
]

export function SkillsContent() {
  return <SkillInventoryPanel skills={DEFAULT_SKILLS} />
}

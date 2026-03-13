'use client'

import { useUIStore } from '@/lib/ui/store'
import { useThreadSurfaceSkills } from '@/lib/ui/api'
import { SkillInventoryPanel } from '@/components/skills/SkillInventoryPanel'

export function SkillsContent() {
  const selectedThreadSurfaceId = useUIStore(s => s.selectedThreadSurfaceId)
  const { data: skills } = useThreadSurfaceSkills(selectedThreadSurfaceId)

  return <SkillInventoryPanel skills={skills ?? []} />
}

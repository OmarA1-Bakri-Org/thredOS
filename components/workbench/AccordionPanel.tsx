'use client'

import * as Accordion from '@radix-ui/react-accordion'
import { ChevronDown, Layers3, ShieldCheck, GitBranch, Activity, Sparkles, BarChart3 } from 'lucide-react'
import { useUIStore } from '@/lib/ui/store'
import type { LucideIcon } from 'lucide-react'
import { ThreadNavigatorContent } from './ThreadNavigatorContent'
import { SkillsContent } from './SkillsContent'
import { StepDetailContent } from '@/components/inspector/StepDetailContent'
import { DependenciesContent } from '@/components/inspector/DependenciesContent'
import { ThreadContextContent } from '@/components/inspector/ThreadContextContent'
import { StructureContent } from '@/components/inspector/StructureContent'

interface AccordionSection {
  key: string
  label: string
  icon: LucideIcon
  content: React.ReactNode
}

const sections: AccordionSection[] = [
  { key: 'navigator', label: 'NAVIGATOR', icon: Layers3, content: <ThreadNavigatorContent /> },
  { key: 'step-detail', label: 'STEP / GATE DETAIL', icon: ShieldCheck, content: <StepDetailContent /> },
  { key: 'dependencies', label: 'DEPENDENCIES', icon: GitBranch, content: <DependenciesContent /> },
  { key: 'thread-context', label: 'THREAD CONTEXT', icon: Activity, content: <ThreadContextContent /> },
  { key: 'skills', label: 'SKILLS', icon: Sparkles, content: <SkillsContent /> },
  { key: 'structure', label: 'STRUCTURE', icon: BarChart3, content: <StructureContent /> },
]

export function AccordionPanel() {
  const activeAccordionSections = useUIStore((s) => s.activeAccordionSections)
  const setActiveAccordionSections = useUIStore((s) => s.setActiveAccordionSections)

  return (
    <div className="w-[380px] shrink-0 border-r border-slate-800/80 bg-[#08101d] overflow-y-auto">
      <div className="px-4 py-3 border-b border-slate-800/60">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
          UNIFIED PANEL
        </span>
      </div>
      <Accordion.Root
        type="multiple"
        value={activeAccordionSections}
        onValueChange={setActiveAccordionSections}
      >
        {sections.map(({ key, label, icon: Icon, content }) => (
          <Accordion.Item key={key} value={key} className="border-b border-slate-800/60">
            <Accordion.Header>
              <Accordion.Trigger className="group flex w-full items-center gap-2 px-4 py-3 text-left">
                <Icon className="h-3.5 w-3.5 text-slate-400 group-data-[state=open]:text-sky-400" />
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500 group-data-[state=open]:text-slate-300">
                  {label}
                </span>
                <ChevronDown className="ml-auto h-3.5 w-3.5 text-slate-600 transition-transform duration-200 group-data-[state=open]:rotate-180" />
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content className="overflow-hidden data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up">
              <div className="max-h-[50vh] overflow-y-auto px-4 py-3">
                {content}
              </div>
            </Accordion.Content>
          </Accordion.Item>
        ))}
      </Accordion.Root>
    </div>
  )
}

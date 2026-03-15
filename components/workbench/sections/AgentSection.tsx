'use client'

import { useState } from 'react'
import { Bot, Wrench, UserCheck, Users, BarChart3, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUIStore } from '@/lib/ui/store'
import { useStatus, useAgentProfile, useThreadSurfaceSkills, useListAgents, useRegisterAgent, useAssignAgent } from '@/lib/ui/api'
import { derivePhases } from '@/lib/ui/phases'
import { ModelPopout } from '@/components/inspector/ModelPopout'

const SKILL_CATALOG = [
  { id: 'search', label: 'Search' },
  { id: 'browser', label: 'Browser' },
  { id: 'model', label: 'Model' },
  { id: 'tools', label: 'Tools' },
  { id: 'files', label: 'Files' },
  { id: 'orchestration', label: 'Orchestration' },
  { id: 'spawn', label: 'Spawn' },
  { id: 'review', label: 'Review' },
  { id: 'code', label: 'Code' },
]

type AgentTab = 'workshop' | 'roster' | 'assign' | 'performance' | 'tools'

const AGENT_TABS: Array<{ id: AgentTab; label: string; icon: typeof Bot }> = [
  { id: 'workshop', label: 'Workshop', icon: Wrench },
  { id: 'roster', label: 'Roster', icon: Users },
  { id: 'assign', label: 'Assign', icon: UserCheck },
  { id: 'performance', label: 'Stats', icon: BarChart3 },
  { id: 'tools', label: 'Tools', icon: Sparkles },
]

function WorkshopView() {
  const [agentName, setAgentName] = useState('')
  const [selectedModel, setSelectedModel] = useState('claude-code')
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set())
  const registerAgent = useRegisterAgent()

  const toggleSkill = (skillId: string) => {
    setSelectedSkills(prev => {
      const next = new Set(prev)
      if (next.has(skillId)) next.delete(skillId)
      else next.add(skillId)
      return next
    })
  }

  const handleRegister = () => {
    const trimmed = agentName.trim()
    if (!trimmed) return
    const agentId = trimmed.toLowerCase().replace(/[^a-z0-9-]/g, '-')
    registerAgent.mutate({
      id: agentId,
      name: trimmed,
      builderId: 'workshop',
      builderName: 'Workshop',
      model: selectedModel,
      skills: SKILL_CATALOG.filter(s => selectedSkills.has(s.id)),
    }, {
      onSuccess: () => {
        setAgentName('')
        setSelectedSkills(new Set())
      },
    })
  }

  return (
    <div className="space-y-3">
      <div className="border border-emerald-500/20 bg-emerald-500/5 px-3 py-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-400/70">Build new agent</div>
        <div className="mt-1 text-[11px] text-slate-400">
          Select a model, add skills, and name your agent to create a new identity.
        </div>
      </div>

      {/* Agent Name */}
      <div className="border border-slate-800 bg-[#0a101a] px-3 py-3">
        <label htmlFor="agent-workshop-name" className="block font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
          Agent name
        </label>
        <input
          id="agent-workshop-name"
          type="text"
          value={agentName}
          onChange={e => setAgentName(e.target.value)}
          placeholder="e.g. code-reviewer-v2"
          className="mt-1.5 w-full border border-slate-700 bg-[#060e1a] px-3 py-1.5 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-emerald-500/50"
        />
      </div>

      {/* Model Selection */}
      <div className="border border-slate-800 bg-[#0a101a] px-3 py-3">
        <label className="block font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
          Model
        </label>
        <div className="mt-1.5">
          <ModelPopout value={selectedModel} onChange={setSelectedModel} />
        </div>
      </div>

      {/* Skills */}
      <div className="border border-slate-800 bg-[#0a101a] px-3 py-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Skills</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SKILL_CATALOG.map(skill => {
            const isSelected = selectedSkills.has(skill.id)
            return (
              <button
                key={skill.id}
                type="button"
                onClick={() => toggleSkill(skill.id)}
                className={`px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] transition-all ${
                  isSelected
                    ? 'border border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                    : 'border border-slate-700/50 bg-slate-950/40 text-slate-500 hover:border-slate-600 hover:text-slate-300'
                }`}
              >
                {skill.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Register button */}
      <Button
        type="button"
        variant="success"
        className="w-full gap-2"
        disabled={!agentName.trim() || registerAgent.isPending}
        onClick={handleRegister}
      >
        <Bot className="h-4 w-4" />
        {registerAgent.isPending ? 'Registering...' : 'Register agent'}
      </Button>

      {registerAgent.isError && (
        <div className="border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
          {(registerAgent.error as Error).message}
        </div>
      )}

      {registerAgent.isSuccess && (
        <div className="border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-300">
          Agent registered successfully.
        </div>
      )}
    </div>
  )
}

function RosterView() {
  const selectedThreadSurfaceId = useUIStore(s => s.selectedThreadSurfaceId)
  const { data: profile } = useAgentProfile(selectedThreadSurfaceId)

  return (
    <div className="space-y-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Registered agents</div>
      {profile ? (
        <div className="border border-emerald-500/20 bg-emerald-500/5 px-3 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center border border-emerald-500/30 bg-emerald-500/10">
              <Bot className="h-4 w-4 text-emerald-300" />
            </div>
            <div>
              <div className="text-sm font-medium text-white">{profile.builder}</div>
              <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-emerald-400/70">
                {profile.pack} · {profile.classification}
              </div>
            </div>
          </div>
          {profile.skills.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {profile.skills.map(skill => (
                <span key={skill.id} className="border border-slate-700/50 bg-slate-950/40 px-1.5 py-0.5 font-mono text-[8px] text-slate-400">
                  {skill.label}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="border border-dashed border-slate-800 px-3 py-4 text-center text-sm text-slate-500">
          No agents registered yet. Build one in the Workshop.
        </div>
      )}
    </div>
  )
}

function AssignView() {
  const selectedPhaseId = useUIStore(s => s.selectedPhaseId)
  const { data: status } = useStatus()
  const phaseDerivation = status ? derivePhases(status.steps, status.gates) : null
  const selectedPhase = phaseDerivation?.phases.find(p => p.id === selectedPhaseId)

  if (!selectedPhase) {
    return (
      <div className="border border-dashed border-slate-800 px-3 py-4 text-center">
        <div className="text-sm text-slate-500">Select a phase to assign an agent.</div>
        <div className="mt-1 text-[11px] text-slate-600">
          Agents are assigned to nodes within phases.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 border-b border-slate-800/60 pb-2">
        <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-emerald-400/70">
          {selectedPhase.label}
        </span>
      </div>
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
        Assign agent to nodes in this phase
      </div>
      {selectedPhase.stepIds.map(stepId => {
        const step = status?.steps.find(s => s.id === stepId)
        return (
          <div key={stepId} className="flex items-center justify-between border border-slate-800 bg-[#0a101a] px-3 py-2.5">
            <div>
              <div className="text-sm text-slate-200">{stepId}</div>
              <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-slate-600">
                {step?.model ?? 'No model'}
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" className="h-6 gap-1 px-2 font-mono text-[9px] uppercase">
              <UserCheck className="h-3 w-3" />
              Assign
            </Button>
          </div>
        )
      })}
    </div>
  )
}

function PerformanceView() {
  return (
    <div className="space-y-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Agent performance</div>
      <div className="grid grid-cols-2 gap-2">
        <div className="border border-slate-800 bg-[#0a101a] px-3 py-2.5">
          <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-600">Runs</div>
          <div className="mt-1 text-lg font-semibold text-white">—</div>
        </div>
        <div className="border border-slate-800 bg-[#0a101a] px-3 py-2.5">
          <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-600">Pass rate</div>
          <div className="mt-1 text-lg font-semibold text-white">—</div>
        </div>
        <div className="border border-slate-800 bg-[#0a101a] px-3 py-2.5">
          <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-600">Avg time</div>
          <div className="mt-1 text-lg font-semibold text-white">—</div>
        </div>
        <div className="border border-slate-800 bg-[#0a101a] px-3 py-2.5">
          <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-600">Quality</div>
          <div className="mt-1 text-lg font-semibold text-white">—</div>
        </div>
      </div>
      <div className="border border-[#16417C]/50 bg-[#16417C]/10 px-3 py-2.5 text-[11px] text-slate-400">
        Performance data populates after agent runs through gates. Rubric scoring tracks quality over time.
      </div>
    </div>
  )
}

function ToolsView() {
  const selectedThreadSurfaceId = useUIStore(s => s.selectedThreadSurfaceId)
  const { data: skills } = useThreadSurfaceSkills(selectedThreadSurfaceId)

  return (
    <div className="space-y-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Tool inventory</div>
      {skills && skills.length > 0 ? (
        <div className="space-y-1.5">
          {skills.map((skill) => (
            <div key={skill.id} className="flex items-center justify-between border border-slate-800 bg-[#0a101a] px-3 py-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-3 w-3 text-sky-400" />
                <span className="text-sm text-slate-200">{skill.label}</span>
              </div>
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-600">
                {skill.inherited ? 'inherited' : 'direct'}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="border border-dashed border-slate-800 px-3 py-4 text-center text-sm text-slate-500">
          No skills registered for this thread surface.
        </div>
      )}
    </div>
  )
}

export function AgentSection() {
  const [activeTab, setActiveTab] = useState<AgentTab>('workshop')

  return (
    <div className="space-y-3" data-testid="agent-section">
      {/* Agent sub-tabs */}
      <div className="flex gap-0.5 border-b border-slate-800/60 pb-1">
        {AGENT_TABS.map(tab => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1 px-2 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] transition-all ${
                isActive
                  ? 'border-b-2 border-emerald-400 text-emerald-300'
                  : 'text-slate-600 hover:text-slate-300'
              }`}
            >
              <Icon className="h-3 w-3" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      {activeTab === 'workshop' && <WorkshopView />}
      {activeTab === 'roster' && <RosterView />}
      {activeTab === 'assign' && <AssignView />}
      {activeTab === 'performance' && <PerformanceView />}
      {activeTab === 'tools' && <ToolsView />}
    </div>
  )
}

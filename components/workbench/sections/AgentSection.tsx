'use client'

import { useState } from 'react'
import { Bot, BarChart3, Sparkles, UserCheck, Users, Wrench } from 'lucide-react'
import { useUIStore } from '@/lib/ui/store'
import { useStatus, useSequence, useListAgents, useAssignAgent, useAgentPerformance, useThreadSurfaceSkills } from '@/lib/ui/api'
import { derivePhases } from '@/lib/ui/phases'
import type { StepStatus, StepType } from '@/lib/sequence/schema'
import type { PromptRef } from '@/lib/library/types'

type StepSkillRef = {
  id: string
  version: number
  capabilities: string[]
  path?: string
}
import { ModelPopout } from '@/components/inspector/ModelPopout'
import { MarkdownAssetEditor } from '@/components/workbench/MarkdownAssetEditor'
import { AssetPicker } from '@/components/workbench/AssetPicker'
import { AgentTopTrumpCard } from '@/components/workbench/AgentTopTrumpCard'
import { buildPromptDrafts, buildSkillDrafts, formatSkillSummary } from '@/components/workbench/libraryAssets'
import { SkillBadgeRow } from '@/components/skills/SkillBadgeRow'

type AgentTab = 'workshop' | 'roster' | 'assign' | 'performance' | 'tools'

const AGENT_TABS: Array<{ id: AgentTab; label: string; icon: typeof Bot }> = [
  { id: 'workshop', label: 'Workshop', icon: Wrench },
  { id: 'roster', label: 'Roster', icon: Users },
  { id: 'assign', label: 'Assign', icon: UserCheck },
  { id: 'performance', label: 'Stats', icon: BarChart3 },
  { id: 'tools', label: 'Tools', icon: Sparkles },
]

interface NodeStepView {
  id: string
  name: string
  type: StepType
  model: string
  status: StepStatus
  dependsOn: string[]
  prompt_file?: string
  prompt_ref?: PromptRef
  skill_refs?: StepSkillRef[]
  node_description?: string
  expected_outcome?: string
  input_contract?: string
  output_contract?: string
  role?: string
  cwd?: string
  assigned_agent_id?: string
}

function mergeStepData(statusStep?: Partial<NodeStepView> | null, sequenceStep?: Partial<NodeStepView> | null): NodeStepView | null {
  if (!statusStep && !sequenceStep) return null
  const merged = { ...statusStep, ...sequenceStep } as NodeStepView
  merged.dependsOn = sequenceStep?.dependsOn ?? statusStep?.dependsOn ?? []
  merged.id = sequenceStep?.id ?? statusStep?.id ?? ''
  merged.name = sequenceStep?.name ?? statusStep?.name ?? merged.id
  merged.type = sequenceStep?.type ?? statusStep?.type ?? 'base'
  merged.model = sequenceStep?.model ?? statusStep?.model ?? 'claude-code'
  merged.status = sequenceStep?.status ?? statusStep?.status ?? 'READY'
  return merged
}

function AgentRegistryCard({
  agent,
  onAssign,
}: {
  agent: import('@/lib/agents/types').AgentRegistration
  onAssign: (agentId: string | null) => void
}) {
  const perf = useAgentPerformance(agent.id).data ?? null

  return (
    <button
      type="button"
      onClick={() => onAssign(agent.id)}
      className="w-full border border-slate-800 bg-[#060e1a] px-3 py-3 text-left transition-all hover:border-emerald-500/30 hover:bg-emerald-500/5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-white">{agent.name}</div>
          <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">
            {agent.model ?? 'model unset'} · v{agent.version ?? 1}
          </div>
        </div>
        <span className="rounded-full border border-slate-700 bg-slate-950/70 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-slate-400">
          {agent.id}
        </span>
      </div>
      <div className="mt-2 text-xs leading-5 text-slate-400">
        {agent.role ?? 'Role unset'} · {agent.description ?? 'Canonical agent registration'}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="rounded-full border border-slate-700 bg-slate-950/70 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-slate-400">
          {formatSkillSummary(agent.skillRefs?.map(ref => ref.id) ?? [])}
        </span>
        <span className="rounded-full border border-slate-700 bg-slate-950/70 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-slate-400">
          {agent.tools?.length ? agent.tools.join(' · ') : 'No tools'}
        </span>
        {agent.composition?.identityHash ? (
          <span className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-emerald-100">
            {agent.composition.identityHash.slice(0, 10)}
          </span>
        ) : null}
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2 text-xs text-slate-400">
        <span className="border border-slate-800 bg-[#08101d] px-2 py-2">Runs {perf?.totalRuns ?? '—'}</span>
        <span className="border border-slate-800 bg-[#08101d] px-2 py-2">Pass {perf ? `${perf.passRate}%` : '—'}</span>
        <span className="border border-slate-800 bg-[#08101d] px-2 py-2">Time {perf ? `${Math.round(perf.avgTimeMs)}ms` : '—'}</span>
        <span className="border border-slate-800 bg-[#08101d] px-2 py-2">Q {perf ? `${perf.quality}/10` : '—'}</span>
      </div>
    </button>
  )
}

function AssignmentRow({
  step,
  agents,
  onAssign,
}: {
  step: NodeStepView
  agents: import('@/lib/agents/types').AgentRegistration[]
  onAssign: (stepId: string, agentId: string | null) => void
}) {
  return (
    <div className="border border-slate-800 bg-[#060e1a] px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm text-white">{step.name}</div>
          <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">
            {step.id} · {step.model} · {step.status}
          </div>
        </div>
        <select
          value={step.assigned_agent_id ?? ''}
          onChange={e => onAssign(step.id, e.target.value || null)}
          className="min-w-0 border border-slate-700 bg-[#08101d] px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500/50"
        >
          <option value="">Unassigned</option>
          {agents.map(agent => (
            <option key={agent.id} value={agent.id}>{agent.name}{agent.model ? ` (${agent.model})` : ''}</option>
          ))}
        </select>
      </div>
    </div>
  )
}

export function AgentSection() {
  const [activeTab, setActiveTab] = useState<AgentTab>('workshop')
  const selectedPhaseId = useUIStore(s => s.selectedPhaseId)
  const selectedNodeId = useUIStore(s => s.selectedNodeId)
  const selectedThreadSurfaceId = useUIStore(s => s.selectedThreadSurfaceId)
  const { data: status } = useStatus()
  const { data: sequence } = useSequence()
  const { data: agents = [] } = useListAgents()
  const assignAgent = useAssignAgent()
  const { data: threadSkills = [] } = useThreadSurfaceSkills(selectedThreadSurfaceId)

  const phaseDerivation = status ? derivePhases(status.steps, status.gates) : null
  const selectedPhase = phaseDerivation?.phases.find(p => p.id === selectedPhaseId)
  const phaseSteps = selectedPhase
    ? status?.steps.filter(s => selectedPhase.stepIds.includes(s.id)) ?? []
    : []

  const focusedStatusStep = selectedNodeId
    ? phaseSteps.find(s => s.id === selectedNodeId)
    : phaseSteps[0] ?? null
  const focusedSequenceStep = selectedNodeId
    ? sequence?.steps.find(s => s.id === selectedNodeId) ?? null
    : sequence?.steps.find(s => s.id === focusedStatusStep?.id) ?? null
  const focusedStep = mergeStepData(focusedStatusStep, focusedSequenceStep)
  const selectedAgent = agents.find(agent => agent.id === focusedStep?.assigned_agent_id) ?? null
  const currentPerformance = useAgentPerformance(selectedAgent?.id ?? null).data ?? null

  const promptAssets = focusedStep ? buildPromptDrafts({
      step: focusedStep,
      sequenceName: status?.name,
      phaseLabel: selectedPhase?.label,
      agent: selectedAgent,
      threadSkills,
    }) : []
  const skillAssets = focusedStep ? buildSkillDrafts(focusedStep, selectedAgent, threadSkills) : []

  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null)
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null)
  const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({})
  const effectivePromptId = promptAssets.some(asset => asset.id === selectedPromptId)
    ? selectedPromptId
    : promptAssets[0]?.id ?? null
  const effectiveSkillId = skillAssets.some(asset => asset.id === selectedSkillId)
    ? selectedSkillId
    : skillAssets[0]?.id ?? null
  const modelDraftKey = selectedAgent?.id ?? focusedStep?.id ?? 'default'
  const modelDraft = modelDrafts[modelDraftKey] ?? selectedAgent?.model ?? focusedStep?.model ?? 'claude-code'

  const selectedPrompt = promptAssets.find(asset => asset.id === effectivePromptId) ?? promptAssets[0] ?? null
  const selectedSkill = skillAssets.find(asset => asset.id === effectiveSkillId) ?? skillAssets[0] ?? null
  const selectedSkillIds = focusedStep?.skill_refs?.map(ref => ref.id) ?? selectedAgent?.skillRefs?.map(ref => ref.id) ?? threadSkills.map(skill => skill.id)
  const phaseLabel = selectedPhase?.label ?? 'No phase selected'

  return (
    <div className="space-y-3" data-testid="agent-section">
      <div className="flex items-center gap-2 border-b border-slate-800/60 pb-2">
        <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-emerald-400/70">{phaseLabel}</span>
        <span className="rounded-full border border-slate-700 bg-slate-950/70 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-slate-400">
          {focusedStep ? focusedStep.id : 'no node selected'}
        </span>
      </div>

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
                isActive ? 'border-b-2 border-emerald-400 text-emerald-300' : 'text-slate-600 hover:text-slate-300'
              }`}
            >
              <Icon className="h-3 w-3" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {activeTab === 'workshop' ? (
        <div className="space-y-3">
          {focusedStep ? (
            <AgentTopTrumpCard
              key={selectedAgent?.id ?? focusedStep.id}
              agent={selectedAgent}
              agents={agents}
              promptAssets={promptAssets}
              skillAssets={skillAssets}
              selectedPromptId={selectedPrompt?.id ?? null}
              selectedSkillId={selectedSkill?.id ?? null}
              onSelectPrompt={setSelectedPromptId}
              onSelectSkill={setSelectedSkillId}
              onAssignAgent={(agentId) => assignAgent.mutate({ stepId: focusedStep.id, agentId })}
              performance={currentPerformance}
            />
          ) : (
            <div className="border border-dashed border-slate-800 px-3 py-4 text-sm text-slate-500">Pick a node to load the agent card.</div>
          )}
        </div>
      ) : null}

      {activeTab === 'roster' ? (
        <div className="space-y-2">
          <div className="border border-slate-800 bg-[#060e1a] px-3 py-3 text-sm text-slate-300">
            Every agent is canonical once registered. Model, role, or attached skill changes mint a new agent identity.
          </div>
          {agents.length > 0 ? (
            <div className="space-y-2">
              {agents.map(agent => (
                <AgentRegistryCard
                  key={agent.id}
                  agent={agent}
                  onAssign={agentId => {
                    if (!focusedStep?.id) return
                    assignAgent.mutate({ stepId: focusedStep.id, agentId })
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="border border-dashed border-slate-800 px-3 py-4 text-center text-sm text-slate-500">No agents registered yet. Build one from the workshop card.</div>
          )}
        </div>
      ) : null}

      {activeTab === 'assign' ? (
        <div className="space-y-3">
          <div className="border border-slate-800 bg-[#060e1a] px-3 py-3 text-sm text-slate-300">
            Assignments stay phase-scoped. Skill-granted spawn work should remain one tier below the parent surface.
          </div>
          {phaseSteps.length > 0 ? (
            <div className="space-y-2">
              {phaseSteps.map(step => {
                const sequenceStep = sequence?.steps.find(s => s.id === step.id)
                const mergedStep = mergeStepData(step, sequenceStep)
                return mergedStep ? (
                  <AssignmentRow
                    key={mergedStep.id}
                    step={mergedStep}
                    agents={agents}
                    onAssign={(stepId, agentId) => assignAgent.mutate({ stepId, agentId })}
                  />
                ) : null
              })}
            </div>
          ) : (
            <div className="border border-dashed border-slate-800 px-3 py-4 text-center text-sm text-slate-500">No steps in the selected phase.</div>
          )}
        </div>
      ) : null}

      {activeTab === 'performance' ? (
        <div className="space-y-3">
          {selectedAgent ? (
            <>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="border border-slate-800 bg-[#060e1a] px-3 py-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Runs</div>
                  <div className="mt-2 text-xl font-semibold text-white">{currentPerformance?.totalRuns ?? '—'}</div>
                </div>
                <div className="border border-slate-800 bg-[#060e1a] px-3 py-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Pass rate</div>
                  <div className="mt-2 text-xl font-semibold text-white">{currentPerformance ? `${currentPerformance.passRate}%` : '—'}</div>
                </div>
                <div className="border border-slate-800 bg-[#060e1a] px-3 py-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Average time</div>
                  <div className="mt-2 text-xl font-semibold text-white">{currentPerformance ? `${Math.round(currentPerformance.avgTimeMs)}ms` : '—'}</div>
                </div>
                <div className="border border-slate-800 bg-[#060e1a] px-3 py-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Quality</div>
                  <div className="mt-2 text-xl font-semibold text-white">{currentPerformance ? `${currentPerformance.quality}/10` : '—'}</div>
                </div>
              </div>
              <div className="border border-slate-800 bg-[#060e1a] px-3 py-3 text-sm text-slate-400">
                Performance is tracked per canonical agent only. If the composition changes materially, a new agent should be registered before reassignment.
              </div>
            </>
          ) : (
            <div className="border border-dashed border-slate-800 px-3 py-4 text-center text-sm text-slate-500">Select an agent to view performance history.</div>
          )}
        </div>
      ) : null}

      {activeTab === 'tools' ? (
        <div className="space-y-3">
          <div className="border border-slate-800 bg-[#060e1a] px-3 py-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Skill inventory</div>
            <div className="mt-2">
              {selectedSkillIds.length ? (
                <SkillBadgeRow skills={selectedSkillIds.map(skillId => ({ id: skillId, label: skillId, inherited: false }))} />
              ) : (
                <div className="text-sm text-slate-500">No skills bound to the selected node or agent.</div>
              )}
            </div>
          </div>
          <AssetPicker
            title="Prompt library"
            items={promptAssets}
            selectedId={selectedPrompt?.id ?? null}
            onSelect={setSelectedPromptId}
            emptyLabel="No prompt drafts available."
          />
          {selectedPrompt ? (
            <MarkdownAssetEditor
              title={selectedPrompt.title}
              path={selectedPrompt.path}
              version={selectedPrompt.version}
              summary={selectedPrompt.summary}
              value={selectedPrompt.content}
              onChange={() => undefined}
              emptyHint="Prompt docs are surfaced here as canonical markdown."
            />
          ) : null}
          <AssetPicker
            title="Skill library"
            items={skillAssets}
            selectedId={selectedSkill?.id ?? null}
            onSelect={setSelectedSkillId}
            emptyLabel="No skill drafts available."
          />
          {selectedSkill ? (
            <MarkdownAssetEditor
              title={selectedSkill.title}
              path={selectedSkill.path}
              version={selectedSkill.version}
              summary={selectedSkill.summary}
              value={selectedSkill.content}
              onChange={() => undefined}
              emptyHint="Skill docs are editable markdown assets."
            />
          ) : null}
          <div className="border border-slate-800 bg-[#060e1a] px-3 py-3 text-xs text-slate-400">
            Prompt and skill docs are canonical, markdown-backed assets. The model selector in the agent card keeps composition changes explicit.
          </div>
          <div className="border border-slate-800 bg-[#060e1a] px-3 py-3">
            <label className="block font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Loadout model draft</label>
            <div className="mt-2">
              <ModelPopout
                value={modelDraft}
                onChange={nextModel => setModelDrafts(prev => ({ ...prev, [modelDraftKey]: nextModel }))}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

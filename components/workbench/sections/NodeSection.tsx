'use client'

import { useMemo, useState } from 'react'
import { Box, GitBranch, ShieldCheck } from 'lucide-react'
import { useUIStore, selectCurrentDepthLevel } from '@/lib/ui/store'
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
import { StepForm } from '@/components/inspector/StepForm'
import { StepActions } from '@/components/inspector/StepActions'
import { MarkdownAssetEditor } from '@/components/workbench/MarkdownAssetEditor'
import { AssetPicker } from '@/components/workbench/AssetPicker'
import { AgentTopTrumpCard } from '@/components/workbench/AgentTopTrumpCard'
import { buildPromptDrafts, buildSkillDrafts, formatSkillSummary } from '@/components/workbench/libraryAssets'
import { SkillBadgeRow } from '@/components/skills/SkillBadgeRow'

type NodePanel = 'overview' | 'prompt' | 'skills' | 'contracts' | 'edit'

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

export function NodeSection() {
  const selectedPhaseId = useUIStore(s => s.selectedPhaseId)
  const selectedNodeId = useUIStore(s => s.selectedNodeId)
  const setSelectedNodeId = useUIStore(s => s.setSelectedNodeId)
  const depthLevel = useUIStore(selectCurrentDepthLevel)
  const { data: status } = useStatus()
  const { data: sequence } = useSequence()
  const { data: agents = [] } = useListAgents()
  const assignAgent = useAssignAgent()
  const selectedThreadSurfaceId = useUIStore(s => s.selectedThreadSurfaceId)
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

  const focusedStep = useMemo(
    () => mergeStepData(focusedStatusStep, focusedSequenceStep),
    [focusedStatusStep, focusedSequenceStep],
  )

  const selectedAgent = useMemo(
    () => agents.find(agent => agent.id === focusedStep?.assigned_agent_id) ?? null,
    [agents, focusedStep?.assigned_agent_id],
  )
  const currentAgentPerformance = useAgentPerformance(focusedStep?.assigned_agent_id ?? null).data ?? null

  const promptAssets = useMemo(
    () => (focusedStep ? buildPromptDrafts({
      step: focusedStep,
      sequenceName: status?.name,
      phaseLabel: selectedPhase?.label,
      agent: selectedAgent,
      threadSkills,
    }) : []),
    [focusedStep, status?.name, selectedPhase?.label, selectedAgent, threadSkills],
  )

  const skillAssets = useMemo(
    () => (focusedStep ? buildSkillDrafts(focusedStep, selectedAgent, threadSkills) : []),
    [focusedStep, selectedAgent, threadSkills],
  )

  const [activeNodePanel, setActiveNodePanel] = useState<NodePanel>('overview')
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null)
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null)
  const effectivePromptId = promptAssets.some(asset => asset.id === selectedPromptId)
    ? selectedPromptId
    : promptAssets[0]?.id ?? null
  const effectiveSkillId = skillAssets.some(asset => asset.id === selectedSkillId)
    ? selectedSkillId
    : skillAssets[0]?.id ?? null

  if (!selectedPhaseId) {
    return (
      <div className="space-y-3" data-testid="node-section">
        <div className="border border-dashed border-slate-800 px-3 py-4 text-center">
          <Box className="mx-auto h-5 w-5 text-slate-600" />
          <div className="mt-2 text-sm text-slate-500">Select a phase first.</div>
          <div className="mt-1 text-[11px] text-slate-600">Choose a phase in the PHASE section to configure its nodes.</div>
        </div>
      </div>
    )
  }

  if (phaseSteps.length === 0 || !focusedStep) {
    return (
      <div className="space-y-3" data-testid="node-section">
        <div className="flex items-center gap-2 border-b border-slate-800/60 pb-2">
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-emerald-400/70">{selectedPhase?.label}</span>
        </div>
        <div className="border border-dashed border-slate-800 px-3 py-4 text-center text-sm text-slate-500">No nodes in this phase.</div>
      </div>
    )
  }

  const selectedPrompt = promptAssets.find(asset => asset.id === effectivePromptId) ?? promptAssets[0] ?? null
  const selectedSkill = skillAssets.find(asset => asset.id === effectiveSkillId) ?? skillAssets[0] ?? null
  const selectedSkillRefs = focusedStep.skill_refs?.map(ref => ref.id) ?? selectedAgent?.skillRefs?.map(ref => ref.id) ?? threadSkills.map(skill => skill.id)

  return (
    <div className="space-y-3" data-testid="node-section">
      <div className="flex items-center justify-between gap-3 border-b border-slate-800/60 pb-2">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-emerald-400/70">{selectedPhase?.label}</span>
          <span className="rounded-full border border-slate-700 bg-slate-950/70 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-slate-400">
            depth {depthLevel}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setSelectedNodeId(focusedStep.id)}
          className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500 hover:text-slate-300"
        >
          focus {focusedStep.id}
        </button>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.18fr)_minmax(0,0.92fr)]">
        <section className="space-y-3 border border-amber-500/20 bg-amber-500/5 px-3 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-400/70">Node Card</div>
              <h3 className="mt-1 text-lg font-semibold tracking-tight text-white">{focusedStep.name}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                {focusedStep.node_description ?? `Node ${focusedStep.id} inside ${status?.name ?? 'the current sequence'}. This is the work unit that carries the prompt, skills, and execution policy for the selected phase.`}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[11px] uppercase tracking-[0.18em]">
              <span className="border border-sky-500/45 bg-sky-500/10 px-2.5 py-0.5 text-sky-100">{focusedStep.type}</span>
              <span className="border border-slate-700 bg-slate-950/60 px-2.5 py-0.5 text-slate-200">{focusedStep.model}</span>
              <span className="border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-0.5 text-emerald-100">{focusedStep.status}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(['overview', 'prompt', 'skills', 'contracts', 'edit'] as NodePanel[]).map(panel => (
              <button
                key={panel}
                type="button"
                onClick={() => setActiveNodePanel(panel)}
                className={`rounded-full border px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.14em] transition-all ${
                  activeNodePanel === panel
                    ? 'border-amber-500/50 bg-amber-500/15 text-amber-100'
                    : 'border-slate-700 bg-slate-950/50 text-slate-500 hover:border-slate-500 hover:text-slate-300'
                }`}
              >
                {panel}
              </button>
            ))}
          </div>

          {activeNodePanel === 'overview' ? (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="border border-slate-800 bg-[#060e1a] px-3 py-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Prompt binding</div>
                <div className="mt-2 break-all text-sm text-slate-100">{focusedStep.prompt_ref?.path ?? focusedStep.prompt_file ?? 'No prompt file bound yet.'}</div>
                <div className="mt-2 text-xs text-slate-500">Prompts are canonical markdown assets attached to the node.</div>
              </div>
              <div className="border border-slate-800 bg-[#060e1a] px-3 py-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Skills</div>
                <div className="mt-2">
                  {selectedSkillRefs.length ? (
                    <SkillBadgeRow skills={selectedSkillRefs.map(skillId => ({ id: skillId, label: skillId, inherited: false }))} />
                  ) : (
                    <div className="text-sm text-slate-500">No skills bound to this node.</div>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {activeNodePanel === 'prompt' ? (
            <div className="space-y-3">
              <AssetPicker
                title="Prompt drafts"
                items={promptAssets}
                selectedId={selectedPrompt?.id ?? null}
                onSelect={setSelectedPromptId}
                emptyLabel="No prompt drafts available for this node."
              />
              {selectedPrompt ? (
                <MarkdownAssetEditor
                  title={selectedPrompt.title}
                  path={selectedPrompt.path}
                  version={selectedPrompt.version}
                  summary={selectedPrompt.summary}
                  value={selectedPrompt.content}
                  onChange={() => undefined}
                  emptyHint="This prompt is editable in markdown form."
                />
              ) : null}
            </div>
          ) : null}

          {activeNodePanel === 'skills' ? (
            <div className="space-y-3">
              <AssetPicker
                title="Skill drafts"
                items={skillAssets}
                selectedId={selectedSkill?.id ?? null}
                onSelect={setSelectedSkillId}
                emptyLabel="No skill drafts available for this node."
              />
              {selectedSkill ? (
                <MarkdownAssetEditor
                  title={selectedSkill.title}
                  path={selectedSkill.path}
                  version={selectedSkill.version}
                  summary={selectedSkill.summary}
                  value={selectedSkill.content}
                  onChange={() => undefined}
                  emptyHint="Skills are canonical markdown docs with the same shape as system skills."
                />
              ) : null}
            </div>
          ) : null}

          {activeNodePanel === 'contracts' ? (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="border border-slate-800 bg-[#060e1a] px-3 py-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Expected outcome</div>
                <div className="mt-2 text-sm leading-6 text-slate-100">{focusedStep.expected_outcome ?? 'No outcome defined yet.'}</div>
              </div>
              <div className="border border-slate-800 bg-[#060e1a] px-3 py-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Working directory</div>
                <div className="mt-2 text-sm text-slate-100">{focusedStep.cwd ?? 'No cwd set.'}</div>
              </div>
              <div className="border border-slate-800 bg-[#060e1a] px-3 py-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Input contract</div>
                <div className="mt-2 text-sm leading-6 text-slate-100">{focusedStep.input_contract ?? 'No input contract defined.'}</div>
              </div>
              <div className="border border-slate-800 bg-[#060e1a] px-3 py-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Output contract</div>
                <div className="mt-2 text-sm leading-6 text-slate-100">{focusedStep.output_contract ?? 'No output contract defined.'}</div>
              </div>
              <div className="border border-slate-800 bg-[#060e1a] px-3 py-3 md:col-span-2">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Spawn rule</div>
                <div className="mt-2 flex flex-wrap gap-2 text-sm text-slate-300">
                  <span className="inline-flex items-center gap-1"><GitBranch className="h-3.5 w-3.5 text-emerald-300" /> child agents only open one surface lower</span>
                  <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5 text-sky-300" /> spawn rights come from a user-granted skill</span>
                </div>
              </div>
            </div>
          ) : null}

          {activeNodePanel === 'edit' ? (
            <div className="space-y-3">
              <StepForm step={focusedStep} />
              <StepActions nodeId={focusedStep.id} isGate={false} />
            </div>
          ) : null}
        </section>

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
          onAssignAgent={agentId => assignAgent.mutate({ stepId: focusedStep.id, agentId })}
          performance={currentAgentPerformance}
        />
      </div>

      <div className="border border-slate-800 bg-[#060e1a] px-3 py-3 text-xs text-slate-400">
        Selected node has {formatSkillSummary(selectedSkillRefs)}. The prompt, skill, and agent cards are all editable surfaces, with markdown-backed assets presented as canonical documents.
      </div>
    </div>
  )
}

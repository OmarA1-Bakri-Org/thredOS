'use client'

import { useEffect, useMemo } from 'react'
import { Box, GitBranch, ShieldCheck } from 'lucide-react'
import { buildAgentComposition, buildRegisteredAgentComposition, detectMaterialChange } from '@/lib/agents/composition'
import { useUIStore, selectCurrentDepthLevel } from '@/lib/ui/store'
import { useStatus, useSequence, useListAgents, useAssignAgent, useAgentPerformance, useThreadSurfaceSkills } from '@/lib/ui/api'
import { derivePhases } from '@/lib/ui/phases'
import type { SkillRef, StepStatus, StepType } from '@/lib/sequence/schema'
import type { PromptRef } from '@/lib/library/types'
import { StepForm } from '@/components/inspector/StepForm'
import { StepActions } from '@/components/inspector/StepActions'
import { MarkdownAssetEditor } from '@/components/workbench/MarkdownAssetEditor'
import { AssetPicker } from '@/components/workbench/AssetPicker'
import { AgentTopTrumpCard } from '@/components/workbench/AgentTopTrumpCard'
import { AVAILABLE_TOOL_OPTIONS, buildPromptDrafts, buildSkillDrafts, formatSkillSummary, formatToolSummary } from '@/components/workbench/libraryAssets'
import { SkillBadgeRow } from '@/components/skills/SkillBadgeRow'
import { applyPromptSelection, buildAgentDraft } from '@/lib/agents/drafts'

type StepSkillRef = SkillRef

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
  const activeNodePanel = useUIStore(s => s.activeNodePanel)
  const setActiveNodePanel = useUIStore(s => s.setActiveNodePanel)
  const activeAgentCardView = useUIStore(s => s.activeAgentCardView)
  const setActiveAgentCardView = useUIStore(s => s.setActiveAgentCardView)
  const agentDraft = useUIStore(s => s.agentDraft)
  const seedAgentDraft = useUIStore(s => s.seedAgentDraft)
  const patchAgentDraft = useUIStore(s => s.patchAgentDraft)
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

  const canonicalPromptAssets = promptAssets.filter(asset => asset.canonical)
  const inheritedPromptRef = selectedAgent?.promptRef ?? focusedStep?.prompt_ref ?? null
  const defaultPromptRefId = inheritedPromptRef?.id ?? (focusedStep?.prompt_file ? focusedStep.id : null)
  const defaultPromptRefVersion = inheritedPromptRef?.version ?? (focusedStep?.prompt_file ? 1 : null)
  const defaultPromptRefPath = inheritedPromptRef?.path ?? focusedStep?.prompt_file ?? null
  const defaultPromptId = defaultPromptRefId ?? canonicalPromptAssets[0]?.id ?? promptAssets[0]?.id ?? null
  const effectivePromptId = promptAssets.some(asset => asset.id === agentDraft.selectedPromptId)
    ? agentDraft.selectedPromptId
    : defaultPromptId
  const defaultSkillRefs = useMemo(
    () => selectedAgent?.skillRefs?.length
      ? selectedAgent.skillRefs.map(ref => ({ ...ref, capabilities: ref.capabilities ?? [] }))
      : focusedStep?.skill_refs?.length
        ? focusedStep.skill_refs
        : threadSkills.map(skill => ({
            id: skill.id,
            version: 1,
            path: `.threados/skills/${skill.id}/SKILL.md`,
            capabilities: [],
          })),
    [focusedStep, selectedAgent, threadSkills],
  )
  const defaultTools = useMemo(
    () => selectedAgent?.tools?.length
      ? selectedAgent.tools
      : AVAILABLE_TOOL_OPTIONS.slice(0, 3).map(tool => tool.id),
    [selectedAgent],
  )

  useEffect(() => {
    if (!focusedStep) return
    const nextDraft = buildAgentDraft({
      step: {
        id: focusedStep.id,
        name: focusedStep.name,
        model: focusedStep.model,
        type: focusedStep.type,
        prompt_file: focusedStep.prompt_ref?.path ?? focusedStep.prompt_file,
        prompt_ref: focusedStep.prompt_ref,
        skill_refs: focusedStep.skill_refs,
        node_description: focusedStep.node_description,
        expected_outcome: focusedStep.expected_outcome,
      },
      agent: selectedAgent,
      promptRef: defaultPromptRefId && defaultPromptRefVersion !== null && defaultPromptRefPath
        ? {
            id: defaultPromptRefId,
            version: defaultPromptRefVersion,
            path: defaultPromptRefPath,
          }
        : null,
      selectedPromptId: defaultPromptId,
      skillRefs: defaultSkillRefs,
      toolIds: defaultTools,
      role: selectedAgent?.role ?? focusedStep.role ?? null,
    })
    if (
      agentDraft.stepId !== focusedStep.id
      || (selectedAgent?.id && agentDraft.id !== selectedAgent.id)
      || (!selectedAgent && agentDraft.name !== nextDraft.name)
    ) {
      seedAgentDraft(nextDraft)
    }
  }, [
    agentDraft.id,
    agentDraft.name,
    agentDraft.stepId,
    defaultPromptId,
    defaultPromptRefId,
    defaultPromptRefPath,
    defaultPromptRefVersion,
    defaultSkillRefs,
    defaultTools,
    focusedStep,
    promptAssets,
    seedAgentDraft,
    selectedAgent,
    selectedThreadSurfaceId,
  ])

  const selectedSkillIds = agentDraft.skillRefs.map(ref => ref.id)
  const selectedToolIds = agentDraft.tools
  const effectiveSkillId = skillAssets.some(asset => asset.id === agentDraft.focusedSkillId)
    ? agentDraft.focusedSkillId
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
  const selectedSkill = skillAssets.find(asset => asset.id === effectiveSkillId) ?? skillAssets.find(asset => selectedSkillIds.includes(asset.id)) ?? skillAssets[0] ?? null
  const currentComposition = selectedAgent
    ? buildRegisteredAgentComposition({
        model: selectedAgent.model,
        role: selectedAgent.role,
        promptRef: selectedAgent.promptRef,
        skillRefs: selectedAgent.skillRefs,
        tools: selectedAgent.tools,
        composition: selectedAgent.composition,
      })
    : null
  const draftComposition = buildAgentComposition({
    model: agentDraft.model || selectedAgent?.model || focusedStep.model,
    role: agentDraft.role || selectedAgent?.role || focusedStep.role || 'worker',
    promptRef: agentDraft.promptRef,
    skillRefs: agentDraft.skillRefs,
    tools: agentDraft.tools,
  })
  const materiality = currentComposition ? detectMaterialChange(currentComposition, draftComposition) : null
  const metadataChanged = selectedAgent
    ? selectedAgent.name !== agentDraft.name || (selectedAgent.description ?? '') !== agentDraft.description
    : false
  const changeSummary = !selectedAgent
    ? {
        title: 'New canonical agent',
        detail: 'Registering this loadout will create a new agent identity.',
      }
    : materiality?.material
      ? {
          title: 'Material change',
          detail: materiality.reasons.join(', '),
        }
      : metadataChanged
        ? {
            title: 'Non-material change',
            detail: 'Only name or description changed. Registration should stay on the same canonical version.',
          }
        : {
            title: 'No canonical change',
            detail: 'This draft matches the currently assigned canonical loadout.',
          }

  const handleSelectPrompt = (promptId: string) => {
    const asset = promptAssets.find(item => item.id === promptId) ?? null
    if (!asset) return
    patchAgentDraft({
      ...applyPromptSelection(agentDraft, {
        id: asset.id,
        version: asset.version,
        path: asset.path,
        canonical: asset.canonical,
      }),
    })
  }

  const resolveSkillRef = (skillId: string): SkillRef => {
    const existing = agentDraft.skillRefs.find(ref => ref.id === skillId)
      ?? defaultSkillRefs.find(ref => ref.id === skillId)
    if (existing) {
      return {
        ...existing,
        capabilities: existing.capabilities ?? [],
      }
    }
    const asset = skillAssets.find(item => item.id === skillId)
    return {
      id: skillId,
      version: asset?.version ?? 1,
      path: asset?.path ?? `.threados/skills/${skillId}/SKILL.md`,
      capabilities: [],
    }
  }

  const toggleSkillSelection = (skillId: string) => {
    const current = agentDraft.skillRefs
    if (current.some(ref => ref.id === skillId)) {
      const next = current.filter(ref => ref.id !== skillId)
      patchAgentDraft({
        skillRefs: next,
        focusedSkillId: agentDraft.focusedSkillId === skillId ? next[0]?.id ?? null : agentDraft.focusedSkillId,
      })
      return
    }
    if (current.length >= 5) return
    patchAgentDraft({
      skillRefs: [...current, resolveSkillRef(skillId)],
      focusedSkillId: skillId,
    })
  }

  const toggleToolSelection = (toolId: string) => {
    const current = agentDraft.tools
    patchAgentDraft({
      tools: current.includes(toolId)
        ? current.filter(id => id !== toolId)
        : [...current, toolId],
    })
  }

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

      <div className="space-y-3">
        <section className="space-y-3 border border-amber-500/20 bg-amber-500/5 px-3 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-400/70">Node Card</div>
              <h3 className="mt-1 text-lg font-semibold tracking-tight text-white">{focusedStep.name}</h3>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                {focusedStep.node_description ?? `Node ${focusedStep.id} inside ${status?.name ?? 'the current sequence'}. This is the work unit carrying the prompt, skills, and execution policy for the selected phase.`}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[11px] uppercase tracking-[0.18em]">
              <span className="border border-sky-500/45 bg-sky-500/10 px-2.5 py-0.5 text-sky-100">{focusedStep.type}</span>
              <span className="border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-0.5 text-emerald-100">{focusedStep.status}</span>
            </div>
          </div>

          <div className="grid gap-2 border border-slate-800/80 bg-[#060e1a] px-3 py-3 text-sm text-slate-300 sm:grid-cols-2 xl:grid-cols-4">
            <div><span className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">Model</span><div className="mt-1 text-slate-100">{focusedStep.model}</div></div>
            <div><span className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">Prompt</span><div className="mt-1 truncate text-slate-100">{focusedStep.prompt_ref?.path ?? focusedStep.prompt_file ?? 'Unbound'}</div></div>
            <div><span className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">Agent</span><div className="mt-1 text-slate-100">{selectedAgent?.name ?? 'Unassigned'}</div></div>
            <div><span className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">Skills</span><div className="mt-1 text-slate-100">{formatSkillSummary(selectedSkillIds)}</div></div>
          </div>

          <AgentTopTrumpCard
            key={selectedAgent?.id ?? focusedStep.id}
            agent={selectedAgent}
            agents={agents}
            promptAssets={promptAssets}
            skillAssets={skillAssets}
            view={activeAgentCardView}
            selectedPromptId={selectedPrompt?.id ?? null}
            focusedSkillId={selectedSkill?.id ?? null}
            selectedSkillIds={selectedSkillIds}
            selectedToolIds={selectedToolIds}
            draftName={agentDraft.name}
            draftDescription={agentDraft.description}
            draftRole={agentDraft.role}
            draftModel={agentDraft.model}
            changeSummary={changeSummary}
            onViewChange={setActiveAgentCardView}
            onSelectPrompt={handleSelectPrompt}
            onSelectSkill={skillId => patchAgentDraft({ focusedSkillId: skillId })}
            onToggleSkill={toggleSkillSelection}
            onToggleTool={toggleToolSelection}
            onDraftNameChange={value => patchAgentDraft({
              name: value,
              ...(selectedAgent
                ? {}
                : {
                    id: value.trim().length > 0
                      ? value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
                      : agentDraft.id,
                  }),
            })}
            onDraftDescriptionChange={value => patchAgentDraft({ description: value })}
            onDraftRoleChange={value => patchAgentDraft({ role: value })}
            onDraftModelChange={value => patchAgentDraft({ model: value })}
            onAssignAgent={agentId => assignAgent.mutate({ stepId: focusedStep.id, agentId })}
            performance={currentAgentPerformance}
          />

          <div className="flex flex-wrap gap-1.5">
            {([
              { id: 'overview', label: 'overview' },
              { id: 'assets', label: 'assets' },
              { id: 'config', label: 'config' },
            ] as const).map(panel => (
              <button
                key={panel.id}
                type="button"
                onClick={() => setActiveNodePanel(panel.id)}
                data-testid={`node-panel-${panel.id}`}
                data-active={activeNodePanel === panel.id ? 'true' : 'false'}
                className={`rounded-full border px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.14em] transition-all ${
                  activeNodePanel === panel.id
                    ? 'border-amber-500/50 bg-amber-500/15 text-amber-100'
                    : 'border-slate-700 bg-slate-950/50 text-slate-500 hover:border-slate-500 hover:text-slate-300'
                }`}
              >
                {panel.label}
              </button>
            ))}
          </div>

          {activeNodePanel === 'overview' ? (
            <div className="space-y-3 border border-slate-800/80 bg-[#060e1a] px-3 py-3">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Node snapshot</div>
                <div className="mt-2 grid gap-3 text-sm text-slate-200 md:grid-cols-2">
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">Goal</div>
                    <div className="mt-1 leading-6 text-slate-100">{focusedStep.expected_outcome ?? 'No outcome defined yet.'}</div>
                  </div>
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">Working directory</div>
                    <div className="mt-1 text-slate-100">{focusedStep.cwd ?? 'No cwd set.'}</div>
                  </div>
                </div>
              </div>
              <div className="border-t border-slate-800/80 pt-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Prompt binding</div>
                <div className="mt-2 truncate text-sm text-slate-100">{focusedStep.prompt_ref?.path ?? focusedStep.prompt_file ?? 'No prompt file bound yet.'}</div>
              </div>
              <div className="border-t border-slate-800/80 pt-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Bound skills</div>
                <div className="mt-2">
                  {selectedSkillIds.length ? (
                    <SkillBadgeRow skills={selectedSkillIds.map(skillId => ({ id: skillId, label: skillId, inherited: false }))} />
                  ) : (
                    <div className="text-sm text-slate-500">No skills bound to this node.</div>
                  )}
                </div>
              </div>
              <div className="border-t border-slate-800/80 pt-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Tool loadout</div>
                <div className="mt-2 text-sm text-slate-100">{formatToolSummary(selectedToolIds)}</div>
              </div>
            </div>
          ) : null}

          {activeNodePanel === 'assets' ? (
            <div className="grid gap-3 xl:grid-cols-2">
              <div className="space-y-3">
                <AssetPicker
                  title="Prompt drafts"
                  items={promptAssets}
                  selectedId={selectedPrompt?.id ?? null}
                  onSelect={handleSelectPrompt}
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
                    defaultMode="preview"
                  />
                ) : null}
              </div>
              <div className="space-y-3">
                <AssetPicker
                  title="Skill drafts"
                  items={skillAssets}
                  selectionMode="multiple"
                  selectedId={selectedSkill?.id ?? null}
                  selectedIds={selectedSkillIds}
                  onSelect={skillId => patchAgentDraft({ focusedSkillId: skillId })}
                  onToggleSelect={toggleSkillSelection}
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
                    defaultMode="preview"
                  />
                ) : null}
                <div className="border border-slate-800 bg-[#060e1a] px-3 py-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Tools</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {AVAILABLE_TOOL_OPTIONS.map(tool => {
                      const selected = selectedToolIds.includes(tool.id)
                      return (
                        <button
                          key={tool.id}
                          type="button"
                          onClick={() => toggleToolSelection(tool.id)}
                          className={`rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] transition-all ${
                            selected
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
                              : 'border-slate-700 bg-slate-950/70 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                          }`}
                        >
                          {tool.label}
                        </button>
                      )
                    })}
                  </div>
                  <div className="mt-2 text-sm text-slate-400">{formatToolSummary(selectedToolIds)}</div>
                </div>
              </div>
            </div>
          ) : null}

          {activeNodePanel === 'config' ? (
            <div className="space-y-3">
              <div className="space-y-3 border border-slate-800/80 bg-[#060e1a] px-3 py-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Input contract</div>
                    <div className="mt-2 text-sm leading-6 text-slate-100">{focusedStep.input_contract ?? 'No input contract defined.'}</div>
                  </div>
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Output contract</div>
                    <div className="mt-2 text-sm leading-6 text-slate-100">{focusedStep.output_contract ?? 'No output contract defined.'}</div>
                  </div>
                </div>
                <div className="border-t border-slate-800/80 pt-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Spawn rule</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-sm text-slate-300">
                    <span className="inline-flex items-center gap-1"><GitBranch className="h-3.5 w-3.5 text-emerald-300" /> child agents only open one surface lower</span>
                    <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5 text-sky-300" /> spawn rights come from a user-granted skill</span>
                  </div>
                </div>
              </div>
              <StepForm step={focusedStep} />
              <StepActions nodeId={focusedStep.id} isGate={false} />
            </div>
          ) : null}
        </section>

      </div>
    </div>
  )
}

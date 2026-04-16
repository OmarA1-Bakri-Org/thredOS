'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow, useViewport } from '@xyflow/react'
import { X, Box, Bot, Folder, Globe, Search, ShieldCheck, Sparkles, Wrench } from 'lucide-react'
import { buildAgentComposition, buildRegisteredAgentComposition, detectMaterialChange } from '@/lib/agents/composition'
import { useUIStore } from '@/lib/ui/store'
import { useAgentProfile, useAssignAgent, useListAgents, useRegisterAgent, useSequence, useStatus } from '@/lib/ui/api'
import { deriveStepThreadSurfaceId } from '@/lib/thread-surfaces/constants'
import type { ThreadRubricMetric } from '@/components/hierarchy/FocusedThreadCard'
import type { ThreadSkillBadge } from '@/lib/thread-surfaces/types'
import { Button } from '@/components/ui/button'
import { AVAILABLE_TOOL_OPTIONS } from '@/components/workbench/libraryAssets'
import { buildAgentDraft, buildAgentRegistrationInput } from '@/lib/agents/drafts'

const skillIcons = {
  search: Search,
  browser: Globe,
  files: Folder,
  tools: Wrench,
  model: Bot,
  review: ShieldCheck,
  orchestration: Sparkles,
} as const

function SkillIcon({ skill }: { skill: ThreadSkillBadge }) {
  const Icon = skillIcons[skill.id as keyof typeof skillIcons] ?? Box
  return (
    <div
      className={`grid h-6 w-6 place-items-center border ${
        skill.inherited
          ? 'border-slate-800 bg-slate-950/70 text-slate-500'
          : 'border-slate-700 bg-slate-900 text-slate-200'
      }`}
      title={skill.label}
    >
      <Icon className="h-3 w-3" />
    </div>
  )
}

function segmentColor(_index: number, total: number): string {
  if (total <= 3) return 'border-rose-400/25 bg-rose-400/60'
  if (total <= 5) return 'border-amber-400/25 bg-amber-400/60'
  if (total <= 7) return 'border-sky-400/25 bg-sky-400/60'
  return 'border-emerald-400/25 bg-emerald-400/60'
}

function StatBar({ value }: { value: number }) {
  return (
    <div className="grid grid-cols-10 gap-0.5">
      {Array.from({ length: 10 }, (_, i) => (
        <div
          key={i}
          className={`h-1.5 border ${
            i < value ? segmentColor(i, value) : 'border-slate-900 bg-slate-900/80'
          }`}
        />
      ))}
    </div>
  )
}

export function AgentDetailCard() {
  const selectedNodeId = useUIStore(s => s.selectedNodeId)
  const setSelectedNodeId = useUIStore(s => s.setSelectedNodeId)
  const sharedAgentDraft = useUIStore(s => s.agentDraft)
  const focusAgentPanel = useUIStore(s => s.focusAgentPanel)
  const seedAgentDraft = useUIStore(s => s.seedAgentDraft)

  const threadSurfaceId = selectedNodeId ? deriveStepThreadSurfaceId(selectedNodeId) : null
  const { data: profile } = useAgentProfile(threadSurfaceId)
  const { data: status } = useStatus()
  const { data: sequence } = useSequence()
  const { data: agents = [] } = useListAgents()
  const registerAgent = useRegisterAgent()
  const assignAgent = useAssignAgent()
  const [actionState, setActionState] = useState<string | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const [cardHeightPx, setCardHeightPx] = useState(620)
  const [cardWidthPx, setCardWidthPx] = useState(320)
  const [containerMetrics, setContainerMetrics] = useState({ width: 1440, height: 900, topInset: 96 })

  const { getNode } = useReactFlow()
  const { x: tx, y: ty, zoom } = useViewport()

  const dismiss = useCallback(() => setSelectedNodeId(null), [setSelectedNodeId])

  const statusStep = status?.steps.find(item => item.id === selectedNodeId) ?? null
  const sequenceStep = sequence?.steps.find(item => item.id === selectedNodeId) ?? null
  const step = useMemo(
    () => (statusStep && sequenceStep ? { ...statusStep, ...sequenceStep } : (sequenceStep ?? statusStep)),
    [sequenceStep, statusStep],
  )
  const assignedAgentId = sequenceStep?.assigned_agent_id ?? null
  const selectedAgent = assignedAgentId
    ? agents.find(agent => agent.id === assignedAgentId) ?? null
    : null
  const promptPath = sequenceStep?.prompt_ref?.path ?? sequenceStep?.prompt_file
  const promptId = sequenceStep?.prompt_ref?.id ?? step?.id ?? null
  const nodeDescription = sequenceStep?.node_description
  const expectedOutcome = sequenceStep?.expected_outcome
  const derivedDraft = (() => {
    if (!step || !threadSurfaceId || !profile) return null
    const skillRefs = selectedAgent?.skillRefs?.length
      ? selectedAgent.skillRefs
      : sequenceStep?.skill_refs?.length
        ? sequenceStep.skill_refs
        : profile.skills.map(skill => ({
            id: skill.id,
            version: 1,
            path: `.threados/skills/${skill.id}/SKILL.md`,
            capabilities: [],
          }))
    return buildAgentDraft({
      step: {
        id: step.id,
        name: step.name,
        model: step.model,
        type: step.type,
        prompt_file: promptPath ?? undefined,
        prompt_ref: sequenceStep?.prompt_ref,
        skill_refs: sequenceStep?.skill_refs,
        node_description: nodeDescription,
        expected_outcome: expectedOutcome,
      },
      agent: selectedAgent,
      promptRef: selectedAgent?.promptRef ?? sequenceStep?.prompt_ref ?? null,
      selectedPromptId: promptId,
      skillRefs,
      toolIds: selectedAgent?.tools?.length
        ? selectedAgent.tools
        : AVAILABLE_TOOL_OPTIONS.slice(0, 3).map(tool => tool.id),
      role: selectedAgent?.role ?? profile.role,
    })
  })()
  const sharedDraftIsUnhydrated = sharedAgentDraft.stepId === step?.id
    && sharedAgentDraft.promptRef == null
    && sharedAgentDraft.selectedPromptId == null
    && sharedAgentDraft.skillRefs.length === 0
    && sharedAgentDraft.tools.length === 0
  const draft = derivedDraft && sharedAgentDraft.stepId === step?.id && !sharedDraftIsUnhydrated
    ? sharedAgentDraft
    : derivedDraft
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
  const draftComposition = draft
    ? buildAgentComposition({
        model: draft.model,
        role: draft.role,
        promptRef: draft.promptRef,
        skillRefs: draft.skillRefs,
        tools: draft.tools,
      })
    : null
  const metadataChanged = draft && selectedAgent
    ? selectedAgent.name !== draft.name || (selectedAgent.description ?? '') !== draft.description
    : false
  const changeSummary = !draft
    ? null
    : !selectedAgent
      ? 'New canonical agent'
      : draftComposition && currentComposition
        ? (() => {
            const decision = detectMaterialChange(currentComposition, draftComposition)
            if (decision.material) return `Material change: ${decision.reasons.join(', ')}`
            if (metadataChanged) return 'Non-material change: name or description only'
            return 'No canonical change'
          })()
        : null

  const openPanel = useCallback((tab: 'workshop' | 'roster' | 'assign' | 'performance' | 'tools' = 'workshop', view: 'overview' | 'prompt' | 'skills' = 'overview') => {
    if (draft) seedAgentDraft(draft)
    focusAgentPanel(tab, view)
  }, [draft, focusAgentPanel, seedAgentDraft])

  const registerCurrentAgent = async () => {
    if (!draft || !threadSurfaceId || !selectedNodeId) return
    setActionState('Registering canonical agent...')
    try {
      const registrationInput = buildAgentRegistrationInput({
        draft,
        agent: selectedAgent,
        threadSurfaceId,
      })

      if (!registrationInput.promptRef) {
        const fallbackPromptId = draft.selectedPromptId ?? step?.id ?? undefined
        registrationInput.promptRef = sequenceStep?.prompt_ref
          ?? (promptPath && fallbackPromptId
            ? {
                id: fallbackPromptId,
                version: 1,
                path: promptPath,
              }
            : null)
      }

      const response = await registerAgent.mutateAsync(registrationInput)
      await assignAgent.mutateAsync({ stepId: selectedNodeId, agentId: response.agent.id })
      seedAgentDraft(buildAgentDraft({
        step: {
          id: step!.id,
          name: step!.name,
          model: step!.model,
          type: step!.type,
          prompt_file: promptPath ?? undefined,
          prompt_ref: sequenceStep?.prompt_ref,
          skill_refs: sequenceStep?.skill_refs,
          node_description: nodeDescription,
          expected_outcome: expectedOutcome,
        },
        agent: response.agent,
        promptRef: response.agent.promptRef ?? draft.promptRef,
        selectedPromptId: response.agent.promptRef?.id ?? draft.selectedPromptId,
        skillRefs: response.agent.skillRefs ?? draft.skillRefs,
        toolIds: response.agent.tools ?? draft.tools,
        role: response.agent.role ?? draft.role,
      }))
      focusAgentPanel('performance', 'overview')
      setActionState(response.materialChange ? 'Registered replacement agent and rebound this node.' : 'Registered agent and assigned it to this node.')
    } catch (error) {
      setActionState(error instanceof Error ? error.message : 'Failed to register agent.')
      openPanel('workshop', 'overview')
    }
  }

  useEffect(() => {
    const wrapper = wrapperRef.current
    const article = wrapper?.querySelector('article')
    const container = wrapper?.parentElement
    if (!wrapper || !article || !container || typeof window === 'undefined') return

    const updateMetrics = () => {
      const topBarRect = document
        .querySelector('[data-workbench-region="top-bar"]')
        ?.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()
      setCardHeightPx(article instanceof HTMLElement ? article.offsetHeight : 620)
      setCardWidthPx(article instanceof HTMLElement ? article.offsetWidth : 320)
      setContainerMetrics({
        width: containerRect.width || window.innerWidth,
        height: containerRect.height || window.innerHeight,
        topInset: Math.max(96, (topBarRect?.bottom ?? containerRect.top) - containerRect.top + 24),
      })
    }

    updateMetrics()
    const articleObserver = new ResizeObserver(updateMetrics)
    const containerObserver = new ResizeObserver(updateMetrics)
    articleObserver.observe(article)
    containerObserver.observe(container)
    window.addEventListener('resize', updateMetrics)

    return () => {
      articleObserver.disconnect()
      containerObserver.disconnect()
      window.removeEventListener('resize', updateMetrics)
    }
  }, [selectedNodeId, profile?.builder, profile?.skills.length])

  if (!selectedNodeId || !profile) return null

  const flowNode = getNode(selectedNodeId)
  if (!flowNode) return null

  const nodeWidth = flowNode.measured?.width ?? (flowNode.type === 'gateNode' ? 96 : 220)
  const cardHalfW = cardWidthPx / 2
  const minMargin = 12
  const scaledCardWidth = cardWidthPx * zoom
  const scaledCardHeight = cardHeightPx * zoom
  const rawCardX = (flowNode.position.x + nodeWidth / 2 - cardHalfW) * zoom + tx
  const rawCardBottom = (flowNode.position.y - 16) * zoom + ty
  const cardX = Math.min(
    Math.max(rawCardX, minMargin),
    containerMetrics.width - scaledCardWidth - minMargin,
  )
  const cardTop = Math.min(
    Math.max(rawCardBottom - scaledCardHeight, containerMetrics.topInset),
    containerMetrics.height - scaledCardHeight - minMargin,
  )

  return (
    <div
      ref={wrapperRef}
      className="pointer-events-auto absolute"
      style={{
        left: cardX,
        top: cardTop,
        zIndex: 1001,
        transformOrigin: '0 0',
        transform: `scale(${zoom})`,
      }}
      onPointerDown={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
    >
      <article
        data-testid="agent-detail-card"
        className="relative w-[320px] overflow-hidden border border-slate-700/80 bg-[#0a101a] shadow-[0_28px_80px_rgba(0,0,0,0.54)]"
        onClick={() => openPanel('workshop', 'overview')}
      >
        <div className="absolute top-0 left-0 w-3 h-3 border-t-[1.5px] border-l-[1.5px] border-sky-400/50" />
        <div className="absolute top-0 right-0 w-3 h-3 border-t-[1.5px] border-r-[1.5px] border-sky-400/50" />
        <div className="absolute bottom-0 left-0 w-3 h-3 border-b-[1.5px] border-l-[1.5px] border-sky-400/50" />
        <div className="absolute bottom-0 right-0 w-3 h-3 border-b-[1.5px] border-r-[1.5px] border-sky-400/50" />

        <div
          className="h-[2px] w-full"
          style={{ background: 'linear-gradient(90deg, #38bdf8cc, #38bdf815)' }}
        />

        <div
          className="absolute left-0 top-[2px] bottom-0 w-[2px]"
          style={{ background: 'linear-gradient(180deg, #818cf8, #818cf830)' }}
        />

        <div className="flex items-center gap-2 border-b border-slate-800/80 px-4 pt-3 pb-2.5">
          <div className="flex flex-wrap gap-1.5 flex-1">
            <span className="rounded-full border border-sky-500/40 bg-sky-500/8 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.2em] text-sky-100">
              {profile.division}
            </span>
            <span className="rounded-full border border-amber-500/40 bg-amber-500/8 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.2em] text-amber-100">
              {profile.classification}
            </span>
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.2em] text-emerald-100">
              {profile.placement}
            </span>
            {profile.verified && (
              <span className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.2em] text-emerald-100 shadow-[0_0_18px_rgba(83,245,138,0.14)]">
                Verified
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              dismiss()
            }}
            onPointerDown={e => e.stopPropagation()}
            className="shrink-0 rounded p-1 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
            aria-label="Close agent card"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="px-4 py-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
            {profile.pack}
          </div>
          <h3 className="mt-1 text-lg font-semibold tracking-tight text-white truncate leading-tight">
            {profile.builder}
          </h3>
        </div>

        <div className="grid grid-cols-2 gap-3 px-4 pb-3">
          <div className="border border-slate-700 bg-slate-900/80 px-3 py-2.5">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Thread Power</div>
            <div className="mt-1 text-xl font-semibold text-white">{profile.threadPower.toFixed(1)}</div>
            <div className="mt-0.5 text-[10px] text-emerald-300">{profile.delta}</div>
          </div>
          <div className="border border-slate-700 bg-slate-900/80 px-3 py-2.5">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Weight</div>
            <div className="mt-1 text-xl font-semibold text-white">{profile.weight.toFixed(1)}</div>
            <div className="mt-0.5 text-[10px] text-slate-400">{profile.division.toLowerCase()} division</div>
          </div>
        </div>

        <section className="mx-4 mb-3 border border-slate-700 bg-slate-950/55 px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Panel Links</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button type="button" size="sm" variant="outline" data-testid="agent-detail-link-prompt" onClick={() => openPanel('workshop', 'prompt')}>Prompt</Button>
            <Button type="button" size="sm" variant="outline" data-testid="agent-detail-link-skills" onClick={() => openPanel('workshop', 'skills')}>Skills</Button>
            <Button type="button" size="sm" variant="outline" data-testid="agent-detail-link-tools" onClick={() => openPanel('tools', 'skills')}>Tools</Button>
            <Button type="button" size="sm" variant="outline" data-testid="agent-detail-link-stats" onClick={() => openPanel('performance', 'overview')}>Stats</Button>
          </div>
        </section>

        {profile.skills.length > 0 && (
          <section className="mx-4 mb-3 cursor-pointer border border-slate-700 bg-slate-950/55 px-3 py-2.5 hover:border-emerald-500/35" onClick={(e) => { e.stopPropagation(); openPanel('workshop', 'skills') }}>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Skill Inventory</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {profile.skills.map(skill => (
                <SkillIcon key={`${skill.id}-${skill.label}`} skill={skill} />
              ))}
            </div>
          </section>
        )}

        {profile.rubric.length > 0 && (
          <section className="mx-4 mb-3 border border-slate-700 bg-slate-950/55 px-3 py-2.5">
            <div className="space-y-1.5">
              {profile.rubric.map((metric: ThreadRubricMetric) => (
                <div key={metric.label} className="grid grid-cols-[5rem_minmax(0,1fr)_1.5rem] items-center gap-2">
                  <div className="font-mono text-[10px] text-slate-300 truncate">{metric.label}</div>
                  <StatBar value={metric.value} />
                  <div className="font-mono text-[10px] text-slate-400 text-right">{metric.value}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="mx-4 mb-3 cursor-pointer border border-slate-700 bg-slate-950/55 px-3 py-2.5 hover:border-sky-500/35" onClick={(e) => { e.stopPropagation(); openPanel('workshop', 'overview') }}>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Provenance</div>
          <div className="mt-2 space-y-1 font-mono text-xs text-slate-300">
            <div><strong className="text-white">Builder:</strong> {profile.builder}</div>
            <div><strong className="text-white">Pack:</strong> {profile.pack}</div>
            <div><strong className="text-white">Title Track:</strong> {profile.classification}</div>
            <div><strong className="text-white">Surface:</strong> {threadSurfaceId}</div>
            <div><strong className="text-white">Source:</strong> {profile.verified ? 'Verified VM run' : 'thredOS local run'}</div>
          </div>
        </section>

        {changeSummary ? (
          <div className="mx-4 mb-3 border border-slate-700 bg-[#08101d] px-3 py-2 text-[11px] text-slate-300">
            {changeSummary}
          </div>
        ) : null}

        {actionState ? (
          <div className="mx-4 mb-3 border border-slate-700 bg-[#08101d] px-3 py-2 text-[11px] text-slate-300">
            {actionState}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-1 border-t border-slate-700/40 px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
          <Button type="button" size="sm" variant="outline" data-testid="agent-detail-open-panel" onClick={() => openPanel('workshop', 'overview')}>Open Panel</Button>
          <Button type="button" size="sm" variant="secondary" data-testid="agent-detail-implement" onClick={() => openPanel('workshop', 'overview')}>Implement</Button>
          <Button type="button" size="sm" variant="success" data-testid="agent-detail-register" onClick={() => void registerCurrentAgent()} disabled={registerAgent.isPending || assignAgent.isPending || !draft}>
            Register
          </Button>
          <Button type="button" size="sm" variant="outline" data-testid="agent-detail-assign" onClick={() => openPanel(selectedAgent ? 'assign' : 'roster', 'overview')}>
            {selectedAgent ? 'Reassign' : 'Assign'}
          </Button>
        </div>
      </article>
    </div>
  )
}
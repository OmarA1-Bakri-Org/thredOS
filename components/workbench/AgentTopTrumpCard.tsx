'use client'

import { useMemo, useState } from 'react'
import { Bot, GitBranch, Wrench, Layers3, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ModelPopout } from '@/components/inspector/ModelPopout'
import { MarkdownAssetEditor } from './MarkdownAssetEditor'
import { AssetPicker } from './AssetPicker'
import { SkillBadgeRow } from '@/components/skills/SkillBadgeRow'
import type { AgentRegistration } from '@/lib/agents/types'
import { AVAILABLE_TOOL_OPTIONS, formatSkillSummary, formatToolSummary, type LibraryAssetDraft } from './libraryAssets'

export interface AgentPerformanceData {
  totalRuns: number
  passRate: number
  avgTimeMs: number
  quality: number
}

interface AgentTopTrumpCardProps {
  agent: AgentRegistration | null
  agents: AgentRegistration[]
  promptAssets: LibraryAssetDraft[]
  skillAssets: LibraryAssetDraft[]
  testIdPrefix?: string
  changeSummary?: { title: string; detail: string } | null
  view: AgentCardView
  selectedPromptId: string | null
  focusedSkillId: string | null
  selectedSkillIds: string[]
  selectedToolIds: string[]
  draftName: string
  draftDescription: string
  draftRole: string
  draftModel: string
  onViewChange: (view: AgentCardView) => void
  onSelectPrompt: (promptId: string) => void
  onSelectSkill: (skillId: string) => void
  onToggleSkill: (skillId: string) => void
  onToggleTool: (toolId: string) => void
  onDraftNameChange: (value: string) => void
  onDraftDescriptionChange: (value: string) => void
  onDraftRoleChange: (value: string) => void
  onDraftModelChange: (value: string) => void
  onAssignAgent: (agentId: string | null) => void
  performance?: AgentPerformanceData | null
}

type AgentCardView = 'overview' | 'prompt' | 'skills'

export function AgentTopTrumpCard({
  agent,
  agents,
  promptAssets,
  skillAssets,
  testIdPrefix,
  changeSummary,
  view,
  selectedPromptId,
  focusedSkillId,
  selectedSkillIds,
  selectedToolIds,
  draftName,
  draftDescription,
  draftRole,
  draftModel,
  onViewChange,
  onSelectPrompt,
  onSelectSkill,
  onToggleSkill,
  onToggleTool,
  onDraftNameChange,
  onDraftDescriptionChange,
  onDraftRoleChange,
  onDraftModelChange,
  onAssignAgent,
  performance,
}: AgentTopTrumpCardProps) {
  const [showPromptEditor, setShowPromptEditor] = useState(false)
  const [showSkillEditor, setShowSkillEditor] = useState(false)

  const selectedPrompt = useMemo(
    () => promptAssets.find(asset => asset.id === selectedPromptId) ?? promptAssets[0] ?? null,
    [promptAssets, selectedPromptId],
  )
  const focusedSkill = useMemo(
    () => skillAssets.find(asset => asset.id === focusedSkillId)
      ?? skillAssets.find(asset => selectedSkillIds.includes(asset.id))
      ?? skillAssets[0]
      ?? null,
    [focusedSkillId, selectedSkillIds, skillAssets],
  )

  const selectedToolSummary = formatToolSummary(selectedToolIds)
  const performanceCards = [
    { label: 'Runs', value: performance?.totalRuns ?? '—' },
    { label: 'Pass rate', value: performance ? `${performance.passRate}%` : '—' },
    { label: 'Avg time', value: performance ? `${Math.round(performance.avgTimeMs)}ms` : '—' },
    { label: 'Quality', value: performance ? `${performance.quality}/10` : '—' },
  ]

  const testId = (suffix: string) => (testIdPrefix ? `${testIdPrefix}-${suffix}` : suffix)

  return (
    <article data-testid="agent-top-trump-card" className="space-y-3 border border-emerald-500/20 bg-emerald-500/5 px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-400/70">Agent Card</div>
          <div className="mt-1 flex items-center gap-2 text-lg font-semibold tracking-tight text-white">
            <Bot className="h-4 w-4 text-emerald-300" />
            {agent?.name ?? 'Unassigned agent'}
          </div>
          <div className="mt-1 text-sm text-slate-300">
            {agent?.description ?? 'Selected node has no registered agent yet. Assign one from the registry or register a new loadout.'}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.18em]">
          <span className="border border-slate-700 bg-slate-950/60 px-2.5 py-0.5 text-slate-200">
            {agent?.role ?? 'Role unset'}
          </span>
          <span className="border border-sky-500/35 bg-sky-500/10 px-2.5 py-0.5 text-sky-100">
            {agent?.model ?? draftModel}
          </span>
          {agent?.composition?.identityHash ? (
            <span className="border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-0.5 text-emerald-100">
              {agent.composition.identityHash.slice(0, 10)}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(['overview', 'prompt', 'skills'] as const).map(item => (
          <Button
            key={item}
            type="button"
            size="sm"
            variant={view === item ? 'default' : 'outline'}
            onClick={() => onViewChange(item)}
            data-testid={testId(`agent-card-tab-${item}`)}
            data-active={view === item ? 'true' : 'false'}
            className="capitalize"
          >
            {item}
          </Button>
        ))}
      </div>

      {view === 'overview' ? (
        <div className="space-y-3">
          <div className="space-y-3 border border-slate-800/80 bg-[#060e1a] px-3 py-3">
            <div className="grid gap-2 text-sm text-slate-200 sm:grid-cols-2">
              <div><strong className="text-white">Version:</strong> {agent?.version ?? 1}</div>
              <div><strong className="text-white">Role:</strong> {draftRole || agent?.role || 'Unspecified'}</div>
              <div><strong className="text-white">Model:</strong> {draftModel}</div>
              <div><strong className="text-white">Skills:</strong> {formatSkillSummary(selectedSkillIds)}</div>
              <div className="sm:col-span-2"><strong className="text-white">Tools:</strong> {selectedToolSummary}</div>
            </div>
            {changeSummary ? (
              <div className="border-t border-slate-800/80 pt-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">{changeSummary.title}</div>
                <div className="mt-2 text-sm text-slate-300">{changeSummary.detail}</div>
              </div>
            ) : null}
            <div className="border-t border-slate-800/80 pt-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="block font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Agent name</label>
                  <input
                    value={draftName}
                    onChange={e => onDraftNameChange(e.target.value)}
                    className="mt-1.5 w-full border border-slate-700 bg-[#08101d] px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500/50"
                  />
                </div>
                <div>
                  <label className="block font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Role</label>
                  <input
                    value={draftRole}
                    onChange={e => onDraftRoleChange(e.target.value)}
                    className="mt-1.5 w-full border border-slate-700 bg-[#08101d] px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500/50"
                  />
                </div>
              </div>
              <div className="mt-3">
                <label className="block font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Description</label>
                <textarea
                  value={draftDescription}
                  onChange={e => onDraftDescriptionChange(e.target.value)}
                  rows={3}
                  className="mt-1.5 w-full resize-none border border-slate-700 bg-[#08101d] px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500/50"
                />
              </div>
            </div>
            <div className="border-t border-slate-800/80 pt-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Registry</div>
              <div className="mt-2 text-sm text-slate-300">
                {agent ? 'Registered canonical agent with lineage.' : 'Pick a registered agent or mint a new one from this loadout.'}
              </div>
              <div className="mt-3">
                <label className="block font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Assign existing agent</label>
                <select
                  value={agent?.id ?? ''}
                  onChange={e => onAssignAgent(e.target.value || null)}
                  className="mt-1.5 w-full border border-slate-700 bg-[#08101d] px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500/50"
                >
                  <option value="">Unassigned</option>
                  {agents.map(item => (
                    <option key={item.id} value={item.id}>{item.name}{item.model ? ` (${item.model})` : ''}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="border-t border-slate-800/80 pt-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Runtime policy</div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400">
                <span className="inline-flex items-center gap-1"><GitBranch className="h-3 w-3 text-emerald-300" /> spawn only through granted skill</span>
                <span className="inline-flex items-center gap-1"><Layers3 className="h-3 w-3 text-sky-300" /> child surfaces open one tier lower</span>
                <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3 text-emerald-300" /> model changes mint a new agent</span>
              </div>
            </div>
            <div className="border-t border-slate-800/80 pt-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Model loadout</div>
              <div className="mt-2 space-y-2">
                <ModelPopout value={draftModel} onChange={onDraftModelChange} />
              </div>
            </div>
          </div>
          {agent?.skills?.length ? (
            <SkillBadgeRow skills={agent.skills.map(skill => ({ ...skill, inherited: skill.inherited ?? false }))} />
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {performanceCards.map(card => (
              <div key={card.label} className="border border-slate-800 bg-[#060e1a] px-3 py-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">{card.label}</div>
                <div className="mt-2 text-xl font-semibold text-white">{card.value}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {view === 'prompt' ? (
        <div className="space-y-3">
          <AssetPicker
            title="Prompt library"
            items={promptAssets}
            selectedId={selectedPrompt?.id ?? null}
            onSelect={id => {
              onSelectPrompt(id)
              setShowPromptEditor(false)
            }}
            emptyLabel="No prompt drafts available yet."
          />
          {selectedPrompt ? (
            <div className="space-y-3">
              <div className="border border-slate-800 bg-[#060e1a] px-3 py-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Selected prompt</div>
                <div className="mt-2 text-sm text-slate-200">{selectedPrompt.summary}</div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="max-w-full truncate rounded-full border border-slate-700 bg-slate-950/70 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-300">
                    {selectedPrompt.path}
                  </span>
                  <span className="rounded-full border border-slate-700 bg-slate-950/70 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-400">
                    v{selectedPrompt.version}
                  </span>
                  <Button type="button" size="sm" variant={showPromptEditor ? 'outline' : 'default'} onClick={() => setShowPromptEditor(v => !v)}>
                    {showPromptEditor ? 'Hide editor' : 'Open editor'}
                  </Button>
                </div>
              </div>
              {showPromptEditor ? (
                <MarkdownAssetEditor
                  title={selectedPrompt.title}
                  path={selectedPrompt.path}
                  version={selectedPrompt.version}
                  summary={selectedPrompt.summary}
                  value={selectedPrompt.content}
                  onChange={() => undefined}
                  emptyHint="Prompt draft is preview-only until the library API is connected."
                  defaultMode="preview"
                />
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {view === 'skills' ? (
        <div className="space-y-3">
          <AssetPicker
            title="Skill library"
            items={skillAssets}
            selectionMode="multiple"
            selectedId={focusedSkill?.id ?? null}
            selectedIds={selectedSkillIds}
            onSelect={id => {
              onSelectSkill(id)
              setShowSkillEditor(false)
            }}
            onToggleSelect={onToggleSkill}
            emptyLabel="No skills available yet."
          />
          <div className="border border-slate-800 bg-[#060e1a] px-3 py-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Selected skills</div>
            <div className="mt-2" data-testid={testId('selected-skills')}>
              {selectedSkillIds.length ? (
                <SkillBadgeRow skills={selectedSkillIds.map(skillId => ({ id: skillId, label: skillId, inherited: false }))} />
              ) : (
                <div className="text-sm text-slate-500">No skills selected.</div>
              )}
            </div>
            <div className="mt-2 text-[11px] text-slate-500">Agents should stay tightly scoped. Keep the loadout to five skills or fewer.</div>
          </div>
          {focusedSkill ? (
            <div className="space-y-3">
              <div className="border border-slate-800 bg-[#060e1a] px-3 py-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Selected skill</div>
                <div className="mt-2 text-sm text-slate-200">{focusedSkill.summary}</div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="max-w-full truncate rounded-full border border-slate-700 bg-slate-950/70 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-300">
                    {focusedSkill.path}
                  </span>
                  <span className="rounded-full border border-slate-700 bg-slate-950/70 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-400">
                    v{focusedSkill.version}
                  </span>
                  <Button type="button" size="sm" variant={showSkillEditor ? 'outline' : 'default'} onClick={() => setShowSkillEditor(v => !v)}>
                    {showSkillEditor ? 'Hide editor' : 'Open editor'}
                  </Button>
                </div>
              </div>
              {showSkillEditor ? (
                <MarkdownAssetEditor
                  title={focusedSkill.title}
                  path={focusedSkill.path}
                  version={focusedSkill.version}
                  summary={focusedSkill.summary}
                  value={focusedSkill.content}
                  onChange={() => undefined}
                  emptyHint="Skill docs are surfaced here as canonical markdown."
                  defaultMode="preview"
                />
              ) : null}
            </div>
          ) : null}
          <div className="border border-slate-800 bg-[#060e1a] px-3 py-3" data-testid={testId('tooling-section')}>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Tooling</div>
            <div className="mt-2 grid gap-2">
              {AVAILABLE_TOOL_OPTIONS.map(tool => {
                const selected = selectedToolIds.includes(tool.id)
                return (
                  <button
                    key={tool.id}
                    type="button"
                    data-testid={testId(`tool-option-${tool.id}`)}
                    onClick={() => onToggleTool(tool.id)}
                    className={`flex w-full items-start justify-between gap-3 border px-3 py-2 text-left transition-all ${
                      selected
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-white'
                        : 'border-slate-800 bg-[#08101d] text-slate-300 hover:border-slate-600 hover:bg-slate-900/80'
                    }`}
                  >
                    <div>
                      <div className="inline-flex items-center gap-1 text-sm font-medium">
                        <Wrench className="h-3.5 w-3.5" />
                        {tool.label}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-slate-500">{tool.summary}</div>
                    </div>
                    <span className="rounded-full border border-slate-700 bg-slate-950/70 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-slate-400">
                      {selected ? 'Selected' : 'Available'}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      ) : null}
    </article>
  )
}

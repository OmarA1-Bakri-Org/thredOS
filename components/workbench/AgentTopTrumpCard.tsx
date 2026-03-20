'use client'

import { useMemo, useState } from 'react'
import { Bot, Cpu, GitBranch, Wrench, Layers3, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ModelPopout } from '@/components/inspector/ModelPopout'
import { MarkdownAssetEditor } from './MarkdownAssetEditor'
import { AssetPicker } from './AssetPicker'
import { SkillBadgeRow } from '@/components/skills/SkillBadgeRow'
import type { AgentRegistration } from '@/lib/agents/types'
import { formatSkillSummary, formatToolSummary, type LibraryAssetDraft } from './libraryAssets'

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
  selectedPromptId: string | null
  selectedSkillId: string | null
  onSelectPrompt: (promptId: string) => void
  onSelectSkill: (skillId: string) => void
  onAssignAgent: (agentId: string | null) => void
  performance?: AgentPerformanceData | null
}

type AgentCardView = 'identity' | 'prompt' | 'skills' | 'tools' | 'model' | 'performance'

export function AgentTopTrumpCard({
  agent,
  agents,
  promptAssets,
  skillAssets,
  selectedPromptId,
  selectedSkillId,
  onSelectPrompt,
  onSelectSkill,
  onAssignAgent,
  performance,
}: AgentTopTrumpCardProps) {
  const [view, setView] = useState<AgentCardView>('identity')
  const [draftModel, setDraftModel] = useState(agent?.model ?? 'claude-code')

  const selectedPrompt = useMemo(
    () => promptAssets.find(asset => asset.id === selectedPromptId) ?? promptAssets[0] ?? null,
    [promptAssets, selectedPromptId],
  )
  const selectedSkill = useMemo(
    () => skillAssets.find(asset => asset.id === selectedSkillId) ?? skillAssets[0] ?? null,
    [skillAssets, selectedSkillId],
  )

  const selectedSkillIds = agent?.skillRefs?.map(ref => ref.id) ?? []
  const selectedToolSummary = formatToolSummary(agent?.tools ?? [])

  return (
    <article data-testid="agent-top-trump-card" className="space-y-3 border border-emerald-500/20 bg-emerald-500/5 px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-400/70">Top Trump card</div>
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
        {(['identity', 'prompt', 'skills', 'tools', 'model', 'performance'] as const).map(item => (
          <Button
            key={item}
            type="button"
            size="sm"
            variant={view === item ? 'default' : 'outline'}
            onClick={() => setView(item)}
            data-testid={`agent-card-tab-${item}`}
            className="capitalize"
          >
            {item}
          </Button>
        ))}
      </div>

      {view === 'identity' ? (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="border border-slate-800 bg-[#060e1a] px-3 py-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Composition</div>
              <div className="mt-2 space-y-2 text-sm text-slate-200">
                <div><strong className="text-white">Version:</strong> {agent?.version ?? 1}</div>
                <div><strong className="text-white">Model:</strong> {agent?.model ?? draftModel}</div>
                <div><strong className="text-white">Role:</strong> {agent?.role ?? 'Unspecified'}</div>
                <div><strong className="text-white">Skills:</strong> {formatSkillSummary(selectedSkillIds)}</div>
                <div><strong className="text-white">Tools:</strong> {selectedToolSummary}</div>
              </div>
            </div>
            <div className="border border-slate-800 bg-[#060e1a] px-3 py-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Registry</div>
              <div className="mt-2 text-sm text-slate-200">
                {agent ? 'Registered agent with performance history and lineage.' : 'Pick a registered agent or mint a new one from this loadout.'}
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
          </div>
          {agent?.skills?.length ? (
            <SkillBadgeRow skills={agent.skills.map(skill => ({ ...skill, inherited: skill.inherited ?? false }))} />
          ) : null}
        </div>
      ) : null}

      {view === 'prompt' ? (
        <div className="space-y-3">
          <AssetPicker
            title="Prompt library"
            items={promptAssets}
            selectedId={selectedPrompt?.id ?? null}
            onSelect={onSelectPrompt}
            emptyLabel="No prompt drafts available yet."
          />
          {selectedPrompt ? (
            <MarkdownAssetEditor
              title={selectedPrompt.title}
              path={selectedPrompt.path}
              version={selectedPrompt.version}
              summary={selectedPrompt.summary}
              value={selectedPrompt.content}
              onChange={() => undefined}
              emptyHint="Prompt draft is preview-only until the library API is connected."
            />
          ) : null}
        </div>
      ) : null}

      {view === 'skills' ? (
        <div className="space-y-3">
          <AssetPicker
            title="Skill library"
            items={skillAssets}
            selectedId={selectedSkill?.id ?? null}
            onSelect={onSelectSkill}
            emptyLabel="No skills available yet."
          />
          {selectedSkill ? (
            <MarkdownAssetEditor
              title={selectedSkill.title}
              path={selectedSkill.path}
              version={selectedSkill.version}
              summary={selectedSkill.summary}
              value={selectedSkill.content}
              onChange={() => undefined}
              emptyHint="Skill docs are surfaced here as canonical markdown."
            />
          ) : null}
        </div>
      ) : null}

      {view === 'tools' ? (
        <div className="space-y-3">
          <div className="border border-slate-800 bg-[#060e1a] px-3 py-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Tools</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(agent?.tools ?? ['files', 'browser', 'search']).map(tool => (
                <span key={tool} className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-950/70 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-200">
                  <Wrench className="h-3 w-3" />
                  {tool}
                </span>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-400">
              <span className="inline-flex items-center gap-1"><GitBranch className="h-3 w-3 text-emerald-300" /> spawn is only valid when granted by a skill</span>
              <span className="inline-flex items-center gap-1"><Layers3 className="h-3 w-3 text-sky-300" /> child surfaces open one tier lower</span>
            </div>
          </div>
        </div>
      ) : null}

      {view === 'model' ? (
        <div className="space-y-3 border border-slate-800 bg-[#060e1a] px-3 py-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Model loadout</div>
          <div className="mt-2 space-y-2">
            <ModelPopout value={agent?.model ?? draftModel} onChange={setDraftModel} />
            <div className="flex flex-wrap gap-2 text-xs text-slate-400">
              <span className="inline-flex items-center gap-1"><Cpu className="h-3 w-3 text-sky-300" /> model changes mint a new agent</span>
              <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3 text-emerald-300" /> keep prompt and skills pinned to the composition</span>
            </div>
          </div>
        </div>
      ) : null}

      {view === 'performance' ? (
        <div className="grid gap-2 md:grid-cols-2">
          <div className="border border-slate-800 bg-[#060e1a] px-3 py-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Runs</div>
            <div className="mt-2 text-xl font-semibold text-white">{performance?.totalRuns ?? '—'}</div>
          </div>
          <div className="border border-slate-800 bg-[#060e1a] px-3 py-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Pass rate</div>
            <div className="mt-2 text-xl font-semibold text-white">{performance ? `${performance.passRate}%` : '—'}</div>
          </div>
          <div className="border border-slate-800 bg-[#060e1a] px-3 py-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Avg time</div>
            <div className="mt-2 text-xl font-semibold text-white">{performance ? `${Math.round(performance.avgTimeMs)}ms` : '—'}</div>
          </div>
          <div className="border border-slate-800 bg-[#060e1a] px-3 py-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Quality</div>
            <div className="mt-2 text-xl font-semibold text-white">{performance ? `${performance.quality}/10` : '—'}</div>
          </div>
        </div>
      ) : null}
    </article>
  )
}

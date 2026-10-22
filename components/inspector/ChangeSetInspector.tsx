'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { ChangeSetReview, ChangeSetSummary } from '@/lib/changesets/diff'
import {
  RuntimeApiError,
  useChangeSetComparison,
  useChangeSetDecision,
  useChangeSetReview,
  useChangeSets,
} from '@/lib/ui/api'

export function canDecideChangeSet(summary: ChangeSetSummary): boolean {
  return summary.status === 'captured' || summary.status === 'validated'
}

interface FileTreeNode {
  name: string
  path: string
  children: FileTreeNode[]
  entry: ChangeSetReview['entries'][number] | null
}

function changeSetFileTree(entries: ChangeSetReview['entries']): FileTreeNode[] {
  const root: FileTreeNode[] = []
  for (const entry of entries) {
    let siblings = root
    const segments = entry.path.split('/')
    for (let index = 0; index < segments.length; index += 1) {
      const name = segments[index]!
      const path = segments.slice(0, index + 1).join('/')
      let node = siblings.find(item => item.name === name)
      if (!node) {
        node = { name, path, children: [], entry: null }
        siblings.push(node)
      }
      if (index === segments.length - 1) node.entry = entry
      siblings = node.children
    }
  }
  const sort = (nodes: FileTreeNode[]) => {
    nodes.sort((left, right) => left.name.localeCompare(right.name))
    nodes.forEach(node => sort(node.children))
  }
  sort(root)
  return root
}

function FileTree({ nodes, selectedPath }: { nodes: FileTreeNode[]; selectedPath: string | null }) {
  return <ul role="group" className="space-y-1 pl-3">{nodes.map(node => <li key={node.path} role="treeitem"
    aria-selected={node.entry ? node.path === selectedPath : undefined}
    className={node.entry && node.path === selectedPath ? 'text-sky-200' : 'text-slate-300'}>
    {node.entry ? <span title={node.path} className="break-all font-mono">{node.name} <span className="text-slate-500">· {node.entry.operation} · {node.entry.content_kind}</span></span>
      : <span className="font-mono text-slate-400">{node.name}/</span>}
    {node.children.length > 0 && <FileTree nodes={node.children} selectedPath={selectedPath} />}
  </li>)}</ul>
}

export function ChangeSetReviewDetails({ review, selectedPath }: {
  review: ChangeSetReview
  selectedPath: string | null
}) {
  const { summary, entries } = review
  const selected = entries.find(entry => entry.path === selectedPath) ?? entries[0]
  return <div className="space-y-4 text-xs text-slate-300" data-testid="change-set-review-details">
    <dl className="grid grid-cols-2 gap-3 border-y border-slate-800 py-3 sm:grid-cols-3">
      <div><dt className="text-slate-500">Status</dt><dd className="mt-1 text-white">{summary.status}</dd></div>
      <div><dt className="text-slate-500">Files</dt><dd className="mt-1 text-white">{summary.entry_count}</dd></div>
      <div><dt className="text-slate-500">Changed bytes</dt><dd className="mt-1 text-white">{summary.total_bytes}</dd></div>
      <div><dt className="text-slate-500">Validation</dt><dd className="mt-1 text-white">{summary.validation.status}</dd></div>
      <div><dt className="text-slate-500">Output contract</dt><dd className="mt-1 text-white">{summary.output_contract_state}</dd></div>
      <div><dt className="text-slate-500">Approval</dt><dd className="mt-1 text-white">{summary.approval_state}</dd></div>
    </dl>
    <p className="text-slate-400">Selection records a preference. It does not approve or apply changes to the project.</p>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <div>
        <h3 className="mb-2 font-medium text-white">File tree</h3>
        {entries.length ? <div role="tree" aria-label="Changed file tree"><FileTree nodes={changeSetFileTree(entries)} selectedPath={selected?.path ?? null} /></div>
          : <p>No file changes captured.</p>}
        {review.file_tree_truncated && <p role="status" className="mt-2 text-amber-200">File list is truncated; remaining files are not shown here.</p>}
      </div>
      <div className="min-w-0">
        {selected ? <>
          <h3 className="mb-2 break-all font-medium text-white">{selected.path}</h3>
          {selected.content_kind === 'binary' ? (
            <div className="space-y-1">
              <p>Binary content · {selected.size_bytes_before} → {selected.size_bytes_after} bytes. Content preview is unavailable.</p>
              <p className="break-all font-mono text-slate-400">Before: {selected.before_sha256 ?? 'none'}</p>
              <p className="break-all font-mono text-slate-400">After: {selected.after_sha256 ?? 'none'}</p>
            </div>
          ) : selected.preview_truncated ? (
            <p role="status" className="text-amber-200">Text preview is truncated or unavailable.</p>
          ) : <>
            <h4 className="mb-1 text-slate-400">Unified diff</h4>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all border border-slate-800 bg-slate-950 p-2 font-mono text-[11px]" data-testid="change-set-diff">{selected.unified_diff ?? 'No textual diff available.'}</pre>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div><h4 className="mb-1 text-slate-400">Before</h4><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all border border-slate-800 p-2 font-mono text-[11px]">{selected.before_text ?? 'Unavailable'}</pre></div>
              <div><h4 className="mb-1 text-slate-400">After</h4><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all border border-slate-800 p-2 font-mono text-[11px]">{selected.after_text ?? 'Unavailable'}</pre></div>
            </div>
          </>}
          {selected.operation === 'symlink' && <p className="mt-2 break-all text-amber-200">Symlink target: {selected.symlink_target_before ?? 'none'} → {selected.symlink_target_after ?? 'none'}</p>}
          {selected.operation === 'chmod' && <p className="mt-2 text-amber-200">Mode: {selected.mode_before ?? 'none'} → {selected.mode_after ?? 'none'}</p>}
        </> : null}
      </div>
    </div>
    <div className="grid gap-3 border-t border-slate-800 pt-3 sm:grid-cols-2">
      <div><h3 className="font-medium text-white">Scope violations</h3>{summary.path_scope_violations.length
        ? <ul className="mt-1 space-y-1 text-amber-200">{summary.path_scope_violations.map(path => <li key={path} className="break-all">{path}</li>)}</ul>
        : <p className="mt-1 text-slate-400">None recorded</p>}</div>
      <div><h3 className="font-medium text-white">Tests and validation evidence</h3>{review.test_evidence_refs.length
        ? <ul className="mt-1 space-y-1">{review.test_evidence_refs.map(ref => <li key={ref} className="break-all">{ref}</li>)}</ul>
        : <p className="mt-1 text-slate-400">No test evidence recorded</p>}</div>
    </div>
    <dl className="grid grid-cols-2 gap-2 border-t border-slate-800 pt-3 sm:grid-cols-3">
      {([['Run', summary.workflow_run_id], ['Attempt', summary.attempt_id], ['Step', summary.step_id],
        ['Surface', summary.surface_id], ['Agent', summary.agent_ref ?? 'Unavailable'],
        ['Workspace', summary.workspace_id], ['Baseline', summary.baseline_snapshot_id],
        ['Root hash', summary.change_set_root_hash]] as const).map(([label, value]) =>
        <div key={label}><dt className="text-slate-500">{label}</dt><dd className="mt-1 break-all font-mono text-slate-200">{value}</dd></div>) }
    </dl>
  </div>
}

export function ChangeSetInspector({ runId, attemptId }: { runId: string; attemptId: string | null }) {
  const [chosenId, setChosenId] = useState<string | null>(null)
  const [chosenPath, setChosenPath] = useState<string | null>(null)
  const [compareAttemptId, setCompareAttemptId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const list = useChangeSets(runId)
  const changeSets = list.data ?? []
  const selectedId = chosenId && changeSets.some(item => item.id === chosenId)
    ? chosenId
    : changeSets.find(item => item.attempt_id === attemptId)?.id ?? changeSets[0]?.id ?? null
  const review = useChangeSetReview(selectedId)
  const decision = useChangeSetDecision(selectedId)
  const selected = review.data?.summary
  const comparison = useChangeSetComparison(runId, selected?.attempt_id ?? null, compareAttemptId)
  const decisionEnabled = Boolean(selected && canDecideChangeSet(selected) && !decision.isPending && !review.isFetching)

  return <section className="space-y-3 border-t border-slate-800 pt-4" data-testid="change-set-inspector" aria-busy={list.isFetching || review.isFetching || decision.isPending}>
    <div><h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">Change Sets</h2>
      <p className="mt-1 text-xs text-slate-500">Review isolated attempt output before any merge or apply.</p></div>
    {list.isError && <p role="alert" className="text-xs text-rose-200">Change Sets unavailable. {list.error.message} <Button type="button" size="sm" variant="outline" onClick={() => void list.refetch()}>Retry</Button></p>}
    {list.isPending && <p role="status" className="text-xs text-slate-400">Loading Change Sets…</p>}
    {list.isSuccess && changeSets.length === 0 && <p className="text-xs text-slate-400">No Change Set has been captured for this run.</p>}
    {changeSets.length > 0 && <div className="grid gap-2 sm:grid-cols-2" aria-label="Captured Change Sets">{changeSets.map(item =>
      <button key={item.id} type="button" aria-pressed={item.id === selectedId}
        data-testid="change-set-candidate"
        className={`border p-3 text-left text-xs transition-colors ${item.id === selectedId ? 'border-sky-500/60 bg-sky-500/10' : 'border-slate-800 hover:border-slate-600'}`}
        onClick={() => { setChosenId(item.id); setChosenPath(null); setCompareAttemptId(null); decision.reset() }}>
        <span className="block break-all font-mono text-slate-100">{item.attempt_id}</span>
        <span className="mt-1 block text-slate-400">{item.status} · {item.entry_count} files · {item.total_bytes} bytes</span>
        <span className="mt-1 block text-slate-500">Validation {item.validation.status} · scope violations {item.path_scope_violations.length}</span>
      </button>)}</div>}
    {selectedId && review.isError && <p role="alert" className="text-xs text-rose-200">Change Set review unavailable. {review.error.message} <Button type="button" size="sm" variant="outline" onClick={() => void review.refetch()}>Retry</Button></p>}
    {selectedId && review.isPending && <p role="status" className="text-xs text-slate-400">Loading review evidence…</p>}
    {review.data && selectedId === review.data.summary.id && <>
      <div className="flex flex-wrap gap-2" aria-label="Select changed file">{review.data.entries.map(entry => <Button
        key={entry.path} type="button" size="sm" variant={(chosenPath ?? review.data!.entries[0]?.path) === entry.path ? 'default' : 'outline'}
        aria-pressed={(chosenPath ?? review.data!.entries[0]?.path) === entry.path} onClick={() => setChosenPath(entry.path)}>{entry.path}</Button>)}</div>
      <ChangeSetReviewDetails review={review.data} selectedPath={chosenPath} />
      {changeSets.length > 1 && <div className="space-y-2 border-t border-slate-800 pt-3 text-xs">
        <label htmlFor="change-set-compare" className="block text-slate-400">Compare with candidate</label>
        <select id="change-set-compare" className="border border-slate-700 bg-slate-950 p-2 text-slate-100"
          value={compareAttemptId ?? ''} onChange={event => setCompareAttemptId(event.target.value || null)}>
          <option value="">Choose an attempt</option>
          {changeSets.filter(item => item.id !== selectedId).map(item => <option key={item.id} value={item.attempt_id}>{item.attempt_id}</option>)}
        </select>
        {comparison.isPending && compareAttemptId && <p role="status">Comparing candidates…</p>}
        {comparison.isError && <p role="alert" className="text-rose-200">Comparison unavailable. {comparison.error.message}</p>}
        {comparison.data && <div data-testid="change-set-comparison"><p>{comparison.data.paths.length} compared paths{comparison.data.truncated ? ' (truncated)' : ''}</p>
          <ul>{comparison.data.paths.map(path => <li key={path.path} className="break-all">{path.path} · {path.relation.replaceAll('_', ' ')}</li>)}</ul></div>}
      </div>}
      <div className="space-y-2 border-t border-slate-800 pt-3 text-xs">
        <p className="text-slate-400">Selection is an operator preference, not approval or application. Merge and apply require separate validation.</p>
        {selected?.decision && <p>Decision: {selected.decision.action} by {selected.decision.actor} at {selected.decision.decided_at}</p>}
        {canDecideChangeSet(review.data.summary) && <>
          <label htmlFor="change-set-reject-reason" className="block text-slate-400">Reason to reject</label>
          <input id="change-set-reject-reason" className="w-full border border-slate-700 bg-slate-950 p-2 text-slate-100"
            value={rejectReason} maxLength={1000} onChange={event => setRejectReason(event.target.value)} />
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={!decisionEnabled} onClick={() => decision.mutate({ action: 'select', expectedRevision: review.data!.summary.revision })}>{decision.isPending ? 'Recording…' : 'Select candidate'}</Button>
            <Button type="button" size="sm" variant="outline" disabled={!decisionEnabled || !rejectReason.trim()} onClick={() => decision.mutate({ action: 'reject', expectedRevision: review.data!.summary.revision, reason: rejectReason })}>Reject candidate</Button>
          </div>
        </>}
        {decision.isError && <p role="alert" className="text-rose-200">Decision was not recorded. {decision.error instanceof RuntimeApiError && decision.error.code === 'CHANGE_SET_REVISION_CONFLICT' ? 'The review changed; reload it before deciding.' : decision.error.message}</p>}
        {decision.isPending && <p role="status">Recording decision…</p>}
        {decision.isSuccess && <p role="status">{decision.data.status === 'selected' ? 'Candidate selected for later merge review.' : 'Candidate rejected.'}</p>}
      </div>
    </>}
  </section>
}

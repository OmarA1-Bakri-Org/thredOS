'use client'

import { useState, type Dispatch } from 'react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useWorkspaceAction, useWorkspaceInspection } from '@/lib/ui/api'
import type { WorkspaceInspection } from '@/lib/workspaces/inspection'

export function workspaceCleanBlocked(inspection: WorkspaceInspection): boolean {
  return !['ready', 'frozen', 'retained', 'failed'].includes(inspection.workspace.status)
    || inspection.processes.some(process => process.status !== 'exited' || process.pid === null)
    || (inspection.attempt != null && ['pending', 'provisioning', 'running'].includes(inspection.attempt.status))
}

export function workspaceRetainBlocked(inspection: WorkspaceInspection): boolean {
  return !['ready', 'frozen', 'failed'].includes(inspection.workspace.status)
    || inspection.processes.some(process => process.status !== 'exited' || process.pid === null)
    || (inspection.attempt != null && ['pending', 'provisioning', 'running'].includes(inspection.attempt.status))
}

export function workspaceExplorerAvailable(inspection: WorkspaceInspection, hasDesktopBridge: boolean): boolean {
  return hasDesktopBridge
    && inspection.workspace.provider === 'copy'
    && inspection.workspace.isolation_label === 'THREADOS_SCOPED'
    && ['ready', 'frozen', 'retained'].includes(inspection.workspace.status)
    && inspection.verification.exists
    && !inspection.diagnostics.some(item => ['WORKSPACE_STORAGE_UNSAFE', 'WORKSPACE_TREE_MISSING', 'WORKSPACE_MANIFEST_INVALID'].includes(item.code))
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let amount = value / 1024
  let unit = units[0]
  for (let index = 1; index < units.length && amount >= 1024; index += 1) {
    amount /= 1024
    unit = units[index]
  }
  return `${amount.toFixed(amount < 10 ? 1 : 0)} ${unit}`
}

function verificationLabel(value: boolean | null): string {
  return value == null ? 'Not verified' : value ? 'Yes' : 'No'
}

function usefulOutputLabel(value: boolean | null): string {
  return value == null ? 'Not verified' : value ? 'Present' : 'None detected'
}

function workspaceDetailRows(inspection: WorkspaceInspection): [string, string | number][] {
  const { workspace, snapshot, verification } = inspection
  return [
    ['Workspace', workspace.id], ['Run', workspace.workflow_run_id], ['Attempt', workspace.attempt_id],
    ['Surface', workspace.surface_id], ['Step', inspection.attempt?.step_id ?? 'Unavailable'],
    ['Snapshot', workspace.snapshot_id], ['Snapshot root hash', snapshot?.root_manifest_hash ?? 'Unavailable'],
    ['Manifest hash', inspection.manifest_hash ?? 'Unavailable'], ['Provider', workspace.provider],
    ['Isolation', workspace.isolation_label], ['External root', workspace.root_path], ['Status', workspace.status],
    ['Files at materialization', workspace.file_count], ['Bytes at materialization', formatBytes(workspace.total_bytes)],
    ['Retention', workspace.retention_policy], ['Root exists', verification.exists ? 'Yes' : 'No'],
    ['Matches baseline', verificationLabel(verification.manifestMatches)],
    ['Useful output', usefulOutputLabel(verification.hasUsefulOutput)],
  ]
}

function WorkspaceProcessDetails({ processes }: Pick<WorkspaceInspection, 'processes'>) {
  return <div className="text-xs text-slate-300"><h3 className="mb-1 font-medium text-slate-100">Processes</h3>{processes.length ? processes.map(process => <p key={process.id}>{process.id} · {process.status} · PID {process.pid ?? 'unavailable'} · exit {process.exit_code ?? 'unavailable'}</p>) : <p>No process record attached.</p>}</div>
}

function WorkspaceBootstrapDetails({ bootstrap }: Pick<WorkspaceInspection, 'bootstrap'>) {
  return <div className="text-xs text-slate-300"><h3 className="mb-1 font-medium text-slate-100">Bootstrap</h3>{bootstrap.length ? bootstrap.map(result => <p key={result.index}>Command {result.index + 1} · {result.status} · {result.duration_ms} ms · exit {result.exit_code ?? 'unavailable'}</p>) : <p>No bootstrap result recorded.</p>}</div>
}

export function WorkspaceInspectionDetails({ inspection }: { inspection: WorkspaceInspection }) {
  const rows = workspaceDetailRows(inspection)
  return <>
    <dl className="grid grid-cols-2 gap-3 text-xs">
      {rows.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-slate-500">{label}</dt><dd className="mt-1 break-all text-slate-200">{value}</dd></div>)}
    </dl>
    {inspection.workspace.isolation_label === 'THREADOS_SCOPED' && <p className="text-xs text-slate-400">Directory-scoped isolation; the host does not enforce this boundary.</p>}
    <WorkspaceProcessDetails processes={inspection.processes} />
    <WorkspaceBootstrapDetails bootstrap={inspection.bootstrap} />
    {inspection.diagnostics.map((diagnostic, index) => <p role="status" className="text-xs text-amber-200" key={`${diagnostic.code}-${index}`}>{diagnostic.code}: {diagnostic.message}</p>)}
  </>
}

type WorkspaceQuery = ReturnType<typeof useWorkspaceInspection>
type WorkspaceAction = ReturnType<typeof useWorkspaceAction>

function explorerActionAvailable(
  inspection: WorkspaceInspection | undefined,
  desktopBridge: Window['thredosDesktop'],
  query: WorkspaceQuery,
  action: WorkspaceAction,
  openingExplorer: boolean,
): boolean {
  return !!inspection && workspaceExplorerAvailable(inspection, typeof desktopBridge?.openWorkspaceInExplorer === 'function')
    && !query.isFetching && !action.isPending && !openingExplorer
}

function workspaceActionBlocked(
  inspection: WorkspaceInspection | undefined,
  blocked: typeof workspaceCleanBlocked,
  action: WorkspaceAction,
  query: WorkspaceQuery,
): boolean {
  return !inspection || blocked(inspection) || action.isPending || query.isError
}

function WorkspaceInspectionStatus({ query, inspection }: { query: WorkspaceQuery; inspection: WorkspaceInspection | undefined }) {
  if (query.isError) return <div role="alert" className="text-xs text-rose-200">Workspace inspection unavailable. {query.error.message}<Button variant="outline" size="sm" onClick={() => { void query.refetch() }}>Retry inspection</Button></div>
  return !inspection ? <p role="status">Loading workspace inspection…</p> : null
}

function WorkspaceInspectionMessages({ inspection, action, cleanBlocked, explorerAvailable, openingExplorer, explorerError }: {
  inspection: WorkspaceInspection
  action: WorkspaceAction
  cleanBlocked: boolean
  explorerAvailable: boolean
  openingExplorer: boolean
  explorerError: string | null
}) {
  return <>
    {cleanBlocked && !action.isPending && inspection.workspace.status !== 'cleaned' && <p className="text-xs text-slate-400">Cleanup is unavailable while execution or verification is unresolved.</p>}
    {inspection.workspace.status === 'cleaned' && <p className="text-xs text-slate-400">Workspace files have been cleaned; canonical runtime records remain available.</p>}
    {!explorerAvailable && !openingExplorer && <p className="text-xs text-slate-500">Explorer is available in Desktop for a verified workspace. Terminal launch is unavailable.</p>}
    {explorerError && <p role="alert" className="text-xs text-rose-200">Explorer could not open this workspace. {explorerError}</p>}
  </>
}

interface WorkspaceInspectorProps {
  workspaceId: string
  onClose: () => void
  onSelectRun: Dispatch<string>
}

export function WorkspaceInspector({ workspaceId, onClose, onSelectRun }: WorkspaceInspectorProps) {
  const query = useWorkspaceInspection(workspaceId)
  const action = useWorkspaceAction(workspaceId)
  const [confirmClean, setConfirmClean] = useState(false)
  const [openingExplorer, setOpeningExplorer] = useState(false)
  const [explorerError, setExplorerError] = useState<string | null>(null)
  const inspection = query.data
  const desktopBridge = typeof window === 'undefined' ? undefined : window.thredosDesktop
  const explorerAvailable = explorerActionAvailable(inspection, desktopBridge, query, action, openingExplorer)
  async function openExplorer() {
    if (!explorerAvailable || !desktopBridge) return
    setExplorerError(null)
    setOpeningExplorer(true)
    try {
      await desktopBridge.openWorkspaceInExplorer(workspaceId)
    } catch (error) {
      setExplorerError(error instanceof Error ? error.message : 'Explorer could not open this workspace')
    } finally {
      setOpeningExplorer(false)
    }
  }
  const cleanBlocked = workspaceActionBlocked(inspection, workspaceCleanBlocked, action, query)
  const retainBlocked = workspaceActionBlocked(inspection, workspaceRetainBlocked, action, query)
  return <section aria-label="Workspace inspector" data-testid="workspace-inspector" className="space-y-4 border border-slate-800 p-4" aria-busy={query.isFetching || action.isPending}>
    <div className="flex items-center justify-between"><h2 className="text-sm text-white">Workspace inspector</h2><Button variant="outline" size="sm" onClick={onClose}>Close inspector</Button></div>
    <WorkspaceInspectionStatus query={query} inspection={inspection} />
    {inspection && <>
      <WorkspaceInspectionDetails inspection={inspection} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => { onSelectRun(inspection.workspace.workflow_run_id) }}>View run</Button>
        <Button size="sm" variant="outline" disabled={!explorerAvailable} onClick={() => { void openExplorer() }}>Open in Explorer</Button>
        <Button size="sm" variant="outline" disabled={retainBlocked} onClick={() => { action.mutate('retain') }}>Retain workspace</Button>
        <Button size="sm" variant="destructive" disabled={cleanBlocked} onClick={() => { setConfirmClean(true) }}>Clean workspace</Button>
      </div>
      <WorkspaceInspectionMessages inspection={inspection} action={action} cleanBlocked={cleanBlocked} explorerAvailable={explorerAvailable} openingExplorer={openingExplorer} explorerError={explorerError} />
    </>}
    {action.isError && <p role="alert" className="text-xs text-rose-200">Workspace action failed. {action.error.message}</p>}
    {action.isPending && <p role="status">Updating workspace…</p>}
    <ConfirmDialog open={confirmClean} title="Clean workspace files?" description="This permanently deletes this workspace's files. Runtime records remain available. The service will reject cleanup if execution or retained evidence makes it unsafe." details={workspaceId} confirmLabel="Delete workspace files" onCancel={() => { setConfirmClean(false) }} onConfirm={() => { setConfirmClean(false); if (!cleanBlocked) action.mutate('clean') }} />
  </section>
}

import type { WorkflowDefinition } from '@/lib/workflows'

export function WorkflowBlueprintPanel({ workflow }: { workflow: WorkflowDefinition }) {
  const totalSteps = workflow.phases.reduce((count, phase) => count + phase.steps.length, 0)
  const connectionCount = workflow.prerequisites.connections.length
  const requiredConnectionCount = workflow.prerequisites.connections.filter(connection => connection.required).length
  const optionalConnectionCount = connectionCount - requiredConnectionCount
  const conditionalStepCount = workflow.phases.reduce(
    (count, phase) => count + phase.steps.filter(step => step.condition).length,
    0,
  )
  const qualityGateCount = workflow.qualityGates.length
  const postCompletionCount = workflow.postCompletion.crossChannelSignals.length
  const connectionPreview = workflow.prerequisites.connections.slice(0, 3)
  const hiddenConnectionCount = Math.max(connectionCount - connectionPreview.length, 0)
  const signalPreview = workflow.postCompletion.crossChannelSignals.slice(0, 2)
  const hiddenSignalCount = Math.max(postCompletionCount - signalPreview.length, 0)

  return (
    <div data-testid="workflow-blueprint-panel" className="space-y-4">
      <section className="border border-[#16417C]/70 bg-[#16417C]/18 px-4 py-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Workflow blueprint</div>
        <h4 className="mt-2 text-lg font-semibold tracking-tight text-white">{workflow.name}</h4>
        <p className="mt-2 max-w-3xl text-sm text-slate-200">{workflow.description}</p>
      </section>

      <section data-testid="workflow-phase-chip-row" className="flex flex-wrap gap-2">
        {workflow.phases.map(phase => (
          <div
            key={phase.phase}
            data-testid="workflow-phase-chip"
            className="rounded-full border border-[#16417C]/70 bg-[#16417C]/16 px-3 py-2"
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
              Phase {phase.phase}
            </div>
            <div className="mt-1 text-sm font-semibold text-white">{phase.label}</div>
            <div className="mt-1 text-xs text-slate-300">{phase.steps.length} step{phase.steps.length === 1 ? '' : 's'}</div>
          </div>
        ))}
      </section>

      <section data-testid="workflow-summary-grid" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="border border-slate-800 bg-[#0a101a] px-3 py-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Structure</div>
          <div className="mt-2 text-sm font-semibold text-white">{workflow.phases.length} phases · {totalSteps} steps</div>
          <div className="mt-1 text-xs text-slate-400">{conditionalStepCount} conditional branches in play</div>
        </div>
        <div className="border border-slate-800 bg-[#0a101a] px-3 py-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Prerequisites</div>
          <div className="mt-2 text-sm font-semibold text-white">{connectionCount} integrations</div>
          <div className="mt-1 text-xs text-slate-400">{requiredConnectionCount} required · {optionalConnectionCount} optional</div>
        </div>
        <div className="border border-slate-800 bg-[#0a101a] px-3 py-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Quality gates</div>
          <div className="mt-2 text-sm font-semibold text-white">{qualityGateCount} validation checkpoints</div>
          <div className="mt-1 text-xs text-slate-400">Formatting and approval checks stay outside the lane body</div>
        </div>
        <div className="border border-slate-800 bg-[#0a101a] px-3 py-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Post-completion</div>
          <div className="mt-2 text-sm font-semibold text-white">{postCompletionCount} cross-channel signals</div>
          <div className="mt-1 text-xs text-slate-400">Telemetry and publication feedback remain visible here</div>
        </div>
      </section>

      <div className="grid gap-4">
        <section data-testid="workflow-connections-panel" className="border border-[#16417C]/70 bg-[#16417C]/18 px-4 py-4">
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Prerequisites</div>
          <div className="mt-3 space-y-2 text-sm text-slate-100">
            {connectionPreview.map(connection => (
              <div key={connection.name} className="border border-slate-800 bg-[#0a101a] px-3 py-3">
                <div>
                  <div className="font-medium text-white">{connection.name}</div>
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-500">{connection.type} · {connection.required ? 'required' : 'optional'}</div>
                </div>
                <div className="mt-2 text-xs uppercase tracking-[0.16em] text-slate-400">fallback · {connection.onUnavailable.replaceAll('_', ' ')}</div>
              </div>
            ))}
            {hiddenConnectionCount > 0 ? (
              <div className="border border-dashed border-slate-800 bg-[#0a101a] px-3 py-2 text-xs uppercase tracking-[0.18em] text-slate-400">
                +{hiddenConnectionCount} more connection{hiddenConnectionCount === 1 ? '' : 's'}
              </div>
            ) : null}
          </div>
        </section>

        <section data-testid="workflow-post-completion-panel" className="border border-slate-700 bg-slate-950/65 px-4 py-4">
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Post-completion</div>
          <div className="mt-3 space-y-2 text-sm text-slate-100">
            {signalPreview.map(signal => (
              <div key={`${signal.type}-${signal.toAgent}`} className="border border-slate-800 bg-[#0a101a] px-3 py-2">
                <div className="font-medium text-white">{signal.type}</div>
                <div className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">{signal.fromAgent} {'->'} {signal.toAgent}</div>
              </div>
            ))}
            {hiddenSignalCount > 0 ? (
              <div className="border border-dashed border-slate-800 bg-[#0a101a] px-3 py-2 text-xs uppercase tracking-[0.18em] text-slate-400">
                +{hiddenSignalCount} more signal{hiddenSignalCount === 1 ? '' : 's'}
              </div>
            ) : null}
            <div className="mt-4 border border-slate-800 bg-[#0a101a] px-3 py-3 text-sm text-slate-300">
              Quality gates: <span className="font-semibold text-white">{workflow.qualityGates.length}</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

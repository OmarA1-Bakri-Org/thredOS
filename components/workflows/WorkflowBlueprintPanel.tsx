import type { WorkflowDefinition } from '@/lib/workflows'

export function WorkflowBlueprintPanel({ workflow }: { workflow: WorkflowDefinition }) {
  return (
    <div data-testid="workflow-blueprint-panel" className="space-y-4">
      <section className="border border-[#16417C]/70 bg-[#16417C]/18 px-4 py-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Workflow blueprint</div>
        <h4 className="mt-2 text-lg font-semibold tracking-tight text-white">{workflow.name}</h4>
        <p className="mt-2 max-w-3xl text-sm text-slate-200">{workflow.description}</p>
      </section>

      <section className="grid gap-4 xl:grid-cols-7">
        {workflow.phases.map(phase => (
          <div
            key={phase.phase}
            data-testid="workflow-phase-column"
            className="border border-[#16417C]/70 bg-[#16417C]/16 px-3 py-3"
          >
            <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-500">
              Phase {phase.phase}
            </div>
            <div className="mt-1 text-sm font-semibold text-white">{phase.label}</div>
            <div className="mt-3 space-y-2">
              {phase.steps.map(step => (
                <div key={step.id} className="border border-slate-800/90 bg-[#08101d] px-2 py-2">
                  <div className="text-sm font-medium text-white">{step.name}</div>
                  <div className="mt-1 flex flex-wrap gap-1 text-[10px] uppercase tracking-[0.18em]">
                    <span className="rounded-full border border-slate-700 bg-slate-950/60 px-2 py-0.5 text-slate-300">
                      {step.execution.replace('_', ' ')}
                    </span>
                    {step.gateCount > 0 ? (
                      <span className="rounded-full border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-amber-100">
                        gates {step.gateCount}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <section
          data-testid="workflow-connections-panel"
          className="border border-[#16417C]/70 bg-[#16417C]/18 px-4 py-4"
        >
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Prerequisites</div>
          <div className="mt-3 space-y-2 text-sm text-slate-100">
            {workflow.prerequisites.connections.map(connection => (
              <div key={connection.name} className="flex items-center justify-between border border-slate-800 bg-[#0a101a] px-3 py-2">
                <div>
                  <div className="font-medium text-white">{connection.name}</div>
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-500">
                    {connection.type} · {connection.required ? 'required' : 'optional'}
                  </div>
                </div>
                <span className="rounded-full border border-slate-700 bg-slate-950/65 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-300">
                  {connection.onUnavailable.replaceAll('_', ' ')}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section
          data-testid="workflow-post-completion-panel"
          className="border border-slate-700 bg-slate-950/65 px-4 py-4"
        >
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Post-completion</div>
          <div className="mt-3 space-y-2 text-sm text-slate-100">
            {workflow.postCompletion.crossChannelSignals.map(signal => (
              <div key={`${signal.type}-${signal.toAgent}`} className="border border-slate-800 bg-[#0a101a] px-3 py-2">
                <div className="font-medium text-white">{signal.type}</div>
                <div className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">
                  {signal.fromAgent} {'->'} {signal.toAgent}
                </div>
              </div>
            ))}
            <div className="mt-4 border border-slate-800 bg-[#0a101a] px-3 py-3 text-sm text-slate-300">
              Quality gates: <span className="font-semibold text-white">{workflow.qualityGates.length}</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

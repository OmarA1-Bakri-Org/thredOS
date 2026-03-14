import type { WorkflowDefinition, WorkflowStep } from '@/lib/workflows'

export function WorkflowStepContextPanel({
  workflow,
  step,
}: {
  workflow: WorkflowDefinition
  step: WorkflowStep
}) {
  const dependencySummary = step.dependsOn.length > 0 ? step.dependsOn.join(', ') : '—'
  const actionSummary = step.actionTypes.length > 0 ? step.actionTypes.join(', ') : '—'
  const outputSummary = step.outputKeys.length > 0 ? step.outputKeys.join(', ') : '—'

  return (
    <div data-testid="workflow-step-context-panel" className="space-y-4">
      <section className="border border-[#16417C]/70 bg-[#16417C]/18 px-4 py-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Step context</div>
        <h4 className="mt-2 text-lg font-semibold tracking-tight text-white">{step.name}</h4>
        <p className="mt-1 text-sm text-slate-400">{step.description}</p>
      </section>

      <section data-testid="workflow-step-summary" className="border border-[#16417C]/70 bg-[#16417C]/16 px-4 py-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Execution summary</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 text-sm text-slate-100">
          <div className="border border-slate-800/90 bg-[#08101d] px-3 py-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">Workflow</div>
            <div className="mt-2 font-medium text-white">{workflow.name}</div>
          </div>
          <div className="border border-slate-800/90 bg-[#08101d] px-3 py-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">Phase / execution</div>
            <div className="mt-2 font-medium text-white">Phase {step.phase} · {step.execution.replace('_', ' ')}</div>
          </div>
          <div className="border border-slate-800/90 bg-[#08101d] px-3 py-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">Timeout / gates</div>
            <div className="mt-2 font-medium text-white">{step.timeoutMs} ms · {step.gateCount} gate{step.gateCount === 1 ? '' : 's'}</div>
          </div>
          <div className="border border-slate-800/90 bg-[#08101d] px-3 py-3 sm:col-span-2 xl:col-span-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">Dependencies</div>
            <div className="mt-2 text-slate-200">{dependencySummary}</div>
          </div>
          {step.condition ? (
            <div className="border border-slate-800/90 bg-[#08101d] px-3 py-3 sm:col-span-2 xl:col-span-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">Condition</div>
              <div className="mt-2 text-slate-200">{step.condition}</div>
            </div>
          ) : null}
        </div>
      </section>

      <section data-testid="workflow-step-actions" className="border border-slate-700 bg-slate-950/65 px-4 py-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Action types</div>
        <p className="mt-2 text-sm text-slate-300">{actionSummary}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.18em]">
          {step.actionTypes.map(actionType => (
            <span key={actionType} className="rounded-full border border-slate-700 bg-slate-950/65 px-3 py-1 text-slate-300">
              {actionType.replace('_', ' ')}
            </span>
          ))}
          {step.gateCount > 0 ? (
            <span className="rounded-full border border-amber-500/35 bg-amber-500/10 px-3 py-1 text-amber-100">
              gates {step.gateCount}
            </span>
          ) : null}
        </div>
      </section>

      <section data-testid="workflow-step-outputs" className="border border-slate-700 bg-slate-950/65 px-4 py-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Outputs</div>
        <p className="mt-2 text-sm text-slate-300">{outputSummary}</p>
        <div className="mt-3 text-sm text-slate-100">
          {step.outputKeys.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {step.outputKeys.map(outputKey => (
                <span key={outputKey} className="rounded-full border border-sky-500/35 bg-sky-500/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-sky-100">
                  {outputKey}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </div>
      </section>
    </div>
  )
}

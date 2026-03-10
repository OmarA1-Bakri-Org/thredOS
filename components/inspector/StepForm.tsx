interface StepData {
  id: string
  name: string
  type: string
  model: string
  status: string
  dependsOn: string[]
}

export function StepForm({ step }: { step: StepData }) {
  return (
    <dl className="mt-4 space-y-4">
      <div className="border border-[#16417C]/70 bg-[#16417C]/18 px-4 py-3">
        <dt className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Name</dt>
        <dd className="mt-2 text-sm font-medium text-white">{step.name}</dd>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="border border-slate-700 bg-slate-950/65 px-4 py-3">
          <dt className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Type</dt>
          <dd className="mt-2 text-sm text-slate-100">{step.type}</dd>
        </div>
        <div className="border border-slate-700 bg-slate-950/65 px-4 py-3">
          <dt className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Model</dt>
          <dd className="mt-2 text-sm text-slate-100">{step.model}</dd>
        </div>
      </div>
      <div className="border border-slate-700 bg-slate-950/65 px-4 py-3">
        <dt className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Status</dt>
        <dd className="mt-2 text-sm font-mono uppercase tracking-[0.14em] text-sky-100">{step.status}</dd>
      </div>
      {step.dependsOn.length > 0 && (
        <div className="border border-slate-700 bg-slate-950/65 px-4 py-3">
          <dt className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Dependencies</dt>
          <dd className="mt-2 text-sm text-slate-100">{step.dependsOn.join(', ')}</dd>
        </div>
      )}
    </dl>
  )
}

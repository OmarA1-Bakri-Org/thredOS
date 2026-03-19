'use client'

import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { FileEdit, FileText, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface MarkdownAssetEditorProps {
  title: string
  path: string
  version: number
  summary: string
  value: string
  onChange: (value: string) => void
  onSave?: () => void
  saveLabel?: string
  emptyHint?: string
}

export function MarkdownAssetEditor({
  title,
  path,
  version,
  summary,
  value,
  onChange,
  onSave,
  saveLabel = 'Save draft',
  emptyHint = 'Draft until the library API is wired.',
}: MarkdownAssetEditorProps) {
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    setDraft(value)
  }, [value])

  return (
    <section className="space-y-3 border border-slate-800 bg-[#0a101a] px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">{title}</div>
          <div className="mt-1 text-sm text-slate-200">{summary}</div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full border border-slate-700 bg-slate-950/70 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-300">
            {path}
          </span>
          <span className="rounded-full border border-slate-700 bg-slate-950/70 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-400">
            v{version}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant={mode === 'edit' ? 'default' : 'outline'} size="sm" onClick={() => setMode('edit')}>
          <FileEdit className="h-3.5 w-3.5" />
          Edit
        </Button>
        <Button type="button" variant={mode === 'preview' ? 'success' : 'outline'} size="sm" onClick={() => setMode('preview')}>
          <FileText className="h-3.5 w-3.5" />
          Preview
        </Button>
        {onSave ? (
          <Button type="button" variant="success" size="sm" onClick={onSave}>
            <Save className="h-3.5 w-3.5" />
            {saveLabel}
          </Button>
        ) : null}
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-600">
          {emptyHint}
        </span>
      </div>

      {mode === 'edit' ? (
        <textarea
          value={draft}
          onChange={e => {
            setDraft(e.target.value)
            onChange(e.target.value)
          }}
          rows={14}
          spellCheck={false}
          className="min-h-[14rem] w-full border border-slate-700 bg-[#060e1a] px-3 py-2.5 font-mono text-[12px] leading-5 text-slate-100 outline-none placeholder:text-slate-600 focus:border-sky-500/50"
        />
      ) : (
        <div className="border border-slate-800 bg-[#060e1a] px-3 py-3">
          <ReactMarkdown
            components={{
              h1: ({ children }) => <h3 className="mb-3 text-lg font-semibold text-white">{children}</h3>,
              h2: ({ children }) => <h4 className="mb-2 mt-4 text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">{children}</h4>,
              p: ({ children }) => <p className="mb-2 text-sm leading-6 text-slate-200">{children}</p>,
              ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5 text-sm text-slate-200">{children}</ul>,
              ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5 text-sm text-slate-200">{children}</ol>,
              code: ({ children }) => <code className="rounded bg-slate-900 px-1 py-0.5 font-mono text-[11px] text-slate-100">{children}</code>,
              a: ({ children, href }) => <a href={href} className="text-sky-300 underline decoration-sky-500/40 underline-offset-2">{children}</a>,
            }}
          >
            {draft || '# Empty draft\n\nStart writing the asset content.'}
          </ReactMarkdown>
        </div>
      )}
    </section>
  )
}

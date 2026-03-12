'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { Sparkles, X } from 'lucide-react'
import { ChatInput } from './ChatInput'
import { MessageBubble } from './MessageBubble'
import { ActionCard } from './ActionCard'
import { DiffPreview } from './DiffPreview'
import { useUIStore } from '@/lib/ui/store'
import type { ProposedAction } from '@/lib/chat/validator'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  actions?: ProposedAction[]
  diff?: string
}

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [applyingMessageId, setApplyingMessageId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const sendMessage = useCallback(async (text: string) => {
    setErrorMessage(null)
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }
    setMessages((prev) => [...prev, userMsg])
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })

      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(payload?.error || 'Thread chat request failed')
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('Thread chat stream was unavailable')

      const decoder = new TextDecoder()
      let assistantContent = ''
      let actions: ProposedAction[] = []
      let diff = ''
      let lineBuffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        lineBuffer += chunk
        const lines = lineBuffer.split('\n')
        lineBuffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'message') assistantContent += event.data.content
            if (event.type === 'actions') actions = event.data.actions
            if (event.type === 'diff') diff = event.data.diff
          } catch {
            // ignore parse errors on partial chunks
          }
        }
      }

      if (lineBuffer.startsWith('data: ')) {
        try {
          const event = JSON.parse(lineBuffer.slice(6))
          if (event.type === 'message') assistantContent += event.data.content
          if (event.type === 'actions') actions = event.data.actions
          if (event.type === 'diff') diff = event.data.diff
        } catch {
          // ignore
        }
      }

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: assistantContent,
        timestamp: Date.now(),
        actions: actions.length > 0 ? actions : undefined,
        diff: diff || undefined,
      }
      setMessages((prev) => [...prev, assistantMsg])
    } catch (error) {
      setErrorMessage((error as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleApply = useCallback(async (messageId: string, actions: ProposedAction[]) => {
    setApplyingMessageId(messageId)
    try {
      const res = await fetch('/api/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actions }),
      })
      const result = await res.json()
      if (!result.success) {
        console.error('Apply failed:', result)
      }
      setMessages((prev) => prev.map(m =>
        m.id === messageId ? { ...m, actions: undefined, diff: undefined } : m
      ).concat({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result.success
          ? `Applied ${actions.length} action(s) successfully.`
          : `Apply failed: ${result.errors?.join(', ') || 'Unknown error'}`,
        timestamp: Date.now(),
      }))
    } catch (error) {
      console.error('Apply error:', error)
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `Apply error: ${(error as Error).message}`,
          timestamp: Date.now(),
        },
      ])
    } finally {
      setApplyingMessageId(null)
    }
  }, [])

  const handleDiscard = useCallback((messageId: string) => {
    setMessages(prev => prev.map(m =>
      m.id === messageId ? { ...m, actions: undefined, diff: undefined } : m
    ))
  }, [])

  const toggleChat = useUIStore(s => s.toggleChat)

  return (
    <div data-testid="chat-floating-container" className="fixed bottom-16 right-4 z-50 w-[400px] h-[500px] rounded-lg border border-slate-700/80 bg-[#08101d]/95 shadow-2xl backdrop-blur-sm">
    <div data-testid="chat-panel" className="flex h-full flex-col bg-transparent" aria-busy={loading}>
      <div data-testid="chat-header" className="border-b border-slate-800/80 bg-[#050c17] rounded-t-lg px-4 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div data-testid="chat-top-pills" className="mb-3 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-slate-700 bg-slate-950/65 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-300">
                Thread Chat
              </span>
              <span className="rounded-full border border-[#16417C]/70 bg-[#16417C]/18 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-100">
                Sequence context
              </span>
              <span className="rounded-full border border-emerald-500/45 bg-emerald-500/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-100">
                Reviewed mutations
              </span>
            </div>
            <div className="mt-2 text-lg font-semibold tracking-tight text-white">Thread dialogue</div>
            <p className="mt-2 max-w-xl text-sm text-slate-300">
              Ask for sequence inspection, rationale, and controlled mutations against the active thread and run context.
            </p>
          </div>
          <div
            data-testid="chat-mode-card"
            className="hidden border border-[#16417C]/70 bg-[#16417C]/18 px-3 py-3 md:block"
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Mode</div>
            <div className="mt-2 flex items-center gap-2 text-sm text-slate-100">
              <Sparkles className="h-4 w-4 text-emerald-300" />
              Context-bound assistant
            </div>
          </div>
          <button
            data-testid="chat-close-button"
            type="button"
            onClick={toggleChat}
            className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
            aria-label="Close chat"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
        {errorMessage ? (
          <div className="mb-4 border border-rose-500/45 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-rose-200/80">Request failed</div>
            <div className="mt-2">{errorMessage}</div>
          </div>
        ) : null}
        {messages.length === 0 && (
          <div data-testid="chat-empty-state" className="border border-[#16417C]/70 bg-[#16417C]/18 px-4 py-4 text-sm text-slate-200">
            <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-500">Ready for bounded guidance</div>
            <div className="mt-3 text-base font-medium text-white">Ask ThreadOS to inspect, modify, or explain the active sequence.</div>
            <div data-testid="chat-empty-example-grid" className="mt-3 grid gap-2 text-sm text-slate-300 lg:grid-cols-2">
              <div className="border border-slate-800/90 bg-[#08101d] px-3 py-3">Summarize the selected thread and current run context.</div>
              <div className="border border-slate-800/90 bg-[#08101d] px-3 py-3">Propose a controlled change and review the diff before applying it.</div>
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id}>
            <MessageBubble role={msg.role} content={msg.content} timestamp={msg.timestamp} />
            {msg.actions && (
              <ActionCard
                actions={msg.actions}
                applying={applyingMessageId === msg.id}
                onApply={(actions) => handleApply(msg.id, actions)}
                onDiscard={() => handleDiscard(msg.id)}
              />
            )}
            {msg.diff && <DiffPreview diff={msg.diff} />}
          </div>
        ))}
        {loading && (
          <div className="border border-slate-700 bg-[#050c17] px-4 py-4 font-mono text-[11px] uppercase tracking-[0.18em] text-slate-400 animate-pulse">
            ThreadOS is reasoning over the active thread surface...
          </div>
        )}
      </div>
      <ChatInput onSend={sendMessage} disabled={loading} />
    </div>
    </div>
  )
}

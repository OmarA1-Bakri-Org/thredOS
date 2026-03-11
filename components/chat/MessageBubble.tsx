import { memo } from 'react'
import Markdown from 'react-markdown'

interface MessageBubbleProps {
  role: 'user' | 'assistant'
  content: string
  timestamp?: number
}

function formatRelativeTime(ts: number): string {
  const delta = Math.floor((Date.now() - ts) / 1000)
  if (delta < 60) return 'just now'
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`
  return `${Math.floor(delta / 86400)}d ago`
}

export const MessageBubble = memo(function MessageBubble({ role, content, timestamp }: MessageBubbleProps) {
  const isUser = role === 'user'

  return (
    <div className={`mb-3 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        data-testid={isUser ? 'chat-message-user' : 'chat-message-assistant'}
        className={`max-w-[80%] border px-4 py-4 text-sm ${
          isUser
            ? 'border-[#16417C] bg-[#16417C]/18 text-slate-100'
            : 'border-slate-700 bg-[#050c17] text-slate-200'
        }`}
      >
        <div className="mb-3 flex items-center justify-between gap-4 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
          <span>{isUser ? 'Builder prompt' : 'ThreadOS response'}</span>
          {timestamp ? <span>{formatRelativeTime(timestamp)}</span> : null}
        </div>
        {isUser ? (
          <div className="leading-6">{content}</div>
        ) : (
          <div className="prose prose-invert prose-sm max-w-none leading-6 prose-p:my-1 prose-pre:my-2 prose-pre:bg-[#0a101a] prose-pre:border prose-pre:border-slate-800 prose-code:text-sky-300 prose-code:before:content-none prose-code:after:content-none prose-headings:text-white prose-a:text-sky-400 prose-strong:text-white prose-li:my-0.5">
            <Markdown>{content}</Markdown>
          </div>
        )}
      </div>
    </div>
  )
})

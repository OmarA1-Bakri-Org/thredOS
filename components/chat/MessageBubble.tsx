import { memo } from 'react'

interface MessageBubbleProps {
  role: 'user' | 'assistant'
  content: string
}

export const MessageBubble = memo(function MessageBubble({ role, content }: MessageBubbleProps) {
  const isUser = role === 'user'

  return (
    <div className={`mb-3 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        data-testid={isUser ? 'chat-message-user' : 'chat-message-assistant'}
        className={`max-w-[80%] border px-4 py-4 text-sm ${
          isUser
            ? 'border-sky-500/45 bg-[#16417C]/18 text-sky-50'
            : 'border-slate-700 bg-slate-950/65 text-slate-200'
        }`}
      >
        <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
          {isUser ? 'Builder prompt' : 'ThreadOS response'}
        </div>
        <div className="leading-6">{content}</div>
      </div>
    </div>
  )
})
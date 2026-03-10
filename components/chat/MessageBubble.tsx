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
        className={`max-w-[80%] border px-3 py-3 text-sm ${
          isUser
            ? 'border-sky-500/45 bg-[#16417C]/18 text-sky-50'
            : 'border-slate-800/90 bg-[#08101d] text-slate-200'
        }`}
      >
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
          {isUser ? 'Builder prompt' : 'ThreadOS response'}
        </div>
        {content}
      </div>
    </div>
  )
})

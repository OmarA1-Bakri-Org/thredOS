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
        className={`max-w-[80%] border px-3 py-3 text-sm ${
          isUser
            ? 'border-sky-500/40 bg-sky-500/10 text-sky-50'
            : 'border-slate-800 bg-slate-950/70 text-slate-200'
        }`}
      >
        {content}
      </div>
    </div>
  )
})

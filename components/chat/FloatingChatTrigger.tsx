'use client'

import { MessageSquare } from 'lucide-react'
import { useUIStore } from '@/lib/ui/store'

export function FloatingChatTrigger() {
  const chatOpen = useUIStore(s => s.chatOpen)
  const toggleChat = useUIStore(s => s.toggleChat)

  if (chatOpen) return null

  return (
    <button
      type="button"
      onClick={toggleChat}
      className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-slate-700 bg-[#08101d] px-4 py-2 font-mono text-sm text-slate-200 shadow-lg transition-colors hover:bg-[#0c1829] hover:text-white"
    >
      <MessageSquare className="h-4 w-4" />
      Chat with thredOS
    </button>
  )
}

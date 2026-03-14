'use client'

import { useEffect } from 'react'
import { useUIStore } from '@/lib/ui/store'

export function useDepthKeyboardNav() {
  const popDepth = useUIStore(s => s.popDepth)
  const jumpToDepth = useUIStore(s => s.jumpToDepth)
  const navigationStack = useUIStore(s => s.navigationStack)

  useEffect(() => {
    if (navigationStack.length <= 1) return

    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      const tag = target.tagName.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) {
        return
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        popDepth()
      } else if (e.key === 'Home') {
        e.preventDefault()
        jumpToDepth(0)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [navigationStack.length, popDepth, jumpToDepth])
}

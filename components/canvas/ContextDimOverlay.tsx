'use client'

import { AnimatePresence, m } from 'motion/react'

interface ContextDimOverlayProps {
  depth: number
}

export function ContextDimOverlay({ depth }: ContextDimOverlayProps) {
  return (
    <AnimatePresence>
      {depth > 0 && (
        <m.div
          key="context-dim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.3 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="absolute inset-0 bg-black pointer-events-none z-10"
        />
      )}
    </AnimatePresence>
  )
}

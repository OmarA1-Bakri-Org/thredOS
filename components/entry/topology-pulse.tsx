'use client'

import { motion } from 'motion/react'
import { cn } from '@/lib/utils'

/**
 * TopologyPulse — a 3-second looping pulse along a vertical gradient line.
 *
 * Visual thesis: thredOS runs locally; only a narrow beam of data crosses
 * into the cloud for account/entitlement/registration. The pulse makes that
 * beam feel alive without shouting — a single travelling dot, subtle glow.
 *
 * The pulse is additive: the existing static gradient line stays visible
 * beneath it (so no loss of visual information if JS is disabled).
 *
 * Reduced-motion is honored via the CSS media query
 * `motion-reduce:hidden` (Tailwind) on the dot, rather than the
 * `useReducedMotion` hook. This keeps the component callable as a pure
 * function in tree-traversal tests that invoke component.type() directly
 * outside a React render pass.
 */
export function TopologyPulse({
  direction = 'down',
  delay = 0,
  className,
}: {
  direction?: 'down' | 'up'
  delay?: number
  className?: string
}) {
  return (
    <div
      className={cn(
        'relative h-14 w-px bg-gradient-to-b from-transparent via-sky-400/70 to-transparent',
        className,
      )}
      aria-hidden="true"
    >
      <motion.span
        initial={{ top: direction === 'down' ? '-10%' : '110%', opacity: 0 }}
        animate={{
          top: direction === 'down' ? ['-10%', '110%'] : ['110%', '-10%'],
          opacity: [0, 1, 1, 0],
        }}
        transition={{
          duration: 2.4,
          delay,
          repeat: Infinity,
          repeatDelay: 0.6,
          ease: 'easeInOut',
          times: [0, 0.15, 0.85, 1],
        }}
        className="absolute left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-sky-300 shadow-[0_0_8px_rgba(125,211,252,0.9)] motion-reduce:hidden"
      />
    </div>
  )
}

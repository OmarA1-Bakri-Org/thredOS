'use client'

import { AnimatePresence, motion } from 'framer-motion'

// Variants that use the `custom` direction prop
const variants = {
  enter: (direction: 'forward' | 'back' | null) => ({
    x: direction === 'forward' ? '100%' : direction === 'back' ? '-100%' : 0,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: 'forward' | 'back' | null) => ({
    x: direction === 'forward' ? '-100%' : direction === 'back' ? '100%' : 0,
    opacity: 0,
  }),
}

interface PortalTransitionProps {
  children: React.ReactNode
  depthKey: string
  direction: 'forward' | 'back' | null
}

export function PortalTransition({ children, depthKey, direction }: PortalTransitionProps) {
  return (
    <AnimatePresence mode="sync" custom={direction}>
      <motion.div
        key={depthKey}
        custom={direction}
        variants={variants}
        initial="enter"
        animate="center"
        exit="exit"
        transition={{
          x: { duration: 0.25, ease: [0.32, 0.72, 0, 1] },
          opacity: { duration: 0.2 },
        }}
        className="absolute inset-0"
        style={{ willChange: 'transform' }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

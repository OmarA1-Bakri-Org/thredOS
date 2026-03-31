import 'framer-motion'
import 'motion/react'

declare module 'framer-motion' {
  interface MotionProps {
    initial?: unknown
    animate?: unknown
    exit?: unknown
    variants?: unknown
    custom?: unknown
    transition?: unknown
  }
}

declare module 'motion/react' {
  interface MotionProps {
    initial?: unknown
    animate?: unknown
    exit?: unknown
    variants?: unknown
    custom?: unknown
    transition?: unknown
  }
}

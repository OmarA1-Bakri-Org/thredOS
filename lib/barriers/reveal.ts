import type { ThreadSurface } from '@/lib/thread-surfaces/types'

export function canReveal(surface: ThreadSurface): boolean {
  return surface.surfaceClass === 'sealed' && surface.revealState === 'sealed'
}

export function revealSurface(surface: ThreadSurface): ThreadSurface {
  if (!canReveal(surface)) {
    throw new Error(`Cannot reveal surface ${surface.id}: surfaceClass=${surface.surfaceClass}, revealState=${surface.revealState}`)
  }
  return {
    ...surface,
    revealState: 'revealed',
    visibility: 'dependency',
  }
}

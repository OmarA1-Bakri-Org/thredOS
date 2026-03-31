import { normalizeThreadSurface, type NormalizedThreadSurface, type ThreadSurface } from '@/lib/thread-surfaces/types'

export function canReveal(surface: ThreadSurface): boolean {
  return surface.surfaceClass === 'sealed' && surface.revealState === 'sealed'
}

export function revealSurface(surface: ThreadSurface): NormalizedThreadSurface {
  const normalized = normalizeThreadSurface(surface)
  if (!canReveal(normalized)) {
    throw new Error(`Cannot reveal surface ${normalized.id}: surfaceClass=${normalized.surfaceClass}, revealState=${normalized.revealState}`)
  }
  return {
    ...normalized,
    revealState: 'revealed',
    visibility: 'dependency',
  }
}

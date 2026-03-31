import { describe, expect, it } from 'bun:test'
import type { ThreadSurface } from '@/lib/thread-surfaces/types'
import { canReveal, revealSurface } from './reveal'

const timestamp = '2026-03-28T10:00:00.000Z'

function makeSealedSurface(overrides: Partial<ThreadSurface> = {}): ThreadSurface {
  return {
    id: 'surface-sealed-001',
    parentSurfaceId: null,
    parentAgentNodeId: null,
    depth: 0,
    surfaceLabel: 'Sealed surface',
    createdAt: timestamp,
    childSurfaceIds: [],
    sequenceRef: null,
    spawnedByAgentId: null,
    surfaceClass: 'sealed',
    visibility: 'self_only',
    isolationLabel: 'THREADOS_SCOPED',
    revealState: 'sealed',
    allowedReadScopes: [],
    allowedWriteScopes: [],
    ...overrides,
  }
}

describe('canReveal', () => {
  it('returns true for a sealed surface with revealState=sealed', () => {
    const surface = makeSealedSurface()
    expect(canReveal(surface)).toBe(true)
  })

  it('returns false for an already-revealed surface (revealState=revealed)', () => {
    const surface = makeSealedSurface({ revealState: 'revealed' })
    expect(canReveal(surface)).toBe(false)
  })

  it('returns false for a non-sealed surface (surfaceClass=shared)', () => {
    const surface = makeSealedSurface({
      surfaceClass: 'shared',
      revealState: null,
    })
    expect(canReveal(surface)).toBe(false)
  })
})

describe('revealSurface', () => {
  it('transitions a sealed surface to revealed and changes visibility to dependency', () => {
    const surface = makeSealedSurface()
    const revealed = revealSurface(surface)

    expect(revealed.revealState).toBe('revealed')
    expect(revealed.visibility).toBe('dependency')
    expect(revealed.id).toBe(surface.id)
    expect(revealed.surfaceClass).toBe('sealed')
  })

  it('does NOT mutate the original surface (immutability check)', () => {
    const surface = makeSealedSurface()
    revealSurface(surface)

    expect(surface.revealState).toBe('sealed')
    expect(surface.visibility).toBe('self_only')
  })

  it('throws if the surface cannot be revealed (already revealed)', () => {
    const surface = makeSealedSurface({ revealState: 'revealed' })
    expect(() => revealSurface(surface)).toThrow(
      `Cannot reveal surface ${surface.id}: surfaceClass=sealed, revealState=revealed`,
    )
  })

  it('throws if the surface cannot be revealed (wrong surfaceClass)', () => {
    const surface = makeSealedSurface({ surfaceClass: 'shared', revealState: null })
    expect(() => revealSurface(surface)).toThrow(
      `Cannot reveal surface ${surface.id}: surfaceClass=shared, revealState=null`,
    )
  })
})

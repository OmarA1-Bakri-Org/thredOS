import { describe, it, expect } from 'bun:test'
import { resolveAccess } from './access-resolver'

describe('resolveAccess', () => {
  it('shared surface allows dependency reads', () => {
    const result = resolveAccess({
      surfaceId: 'surface-a',
      surfaceClass: 'shared',
      visibility: 'public',
      revealState: null,
      requestorSurfaceId: 'surface-b',
      allowedReadScopes: ['surface-b'],
      crossSurfaceReads: 'dependency_only',
    })
    expect(result.canRead).toBe(true)
    expect(result.canReadSemantics).toBe(true)
    expect(result.canReadManifest).toBe(true)
  })

  it('sealed surface denies all reads pre-reveal (canRead=false, canReadSemantics=false, canReadManifest=true)', () => {
    const result = resolveAccess({
      surfaceId: 'surface-a',
      surfaceClass: 'sealed',
      visibility: 'public',
      revealState: null,
      requestorSurfaceId: 'surface-b',
      allowedReadScopes: ['surface-b'],
      crossSurfaceReads: 'allow',
    })
    expect(result.canRead).toBe(false)
    expect(result.canReadSemantics).toBe(false)
    expect(result.canReadManifest).toBe(true)
    expect(result.reason).toBe('sealed surface pre-reveal: manifest only')
  })

  it('sealed surface allows reads after reveal', () => {
    const result = resolveAccess({
      surfaceId: 'surface-a',
      surfaceClass: 'sealed',
      visibility: 'public',
      revealState: 'revealed',
      requestorSurfaceId: 'surface-b',
      allowedReadScopes: ['surface-b'],
      crossSurfaceReads: 'allow',
    })
    expect(result.canRead).toBe(true)
    expect(result.canReadSemantics).toBe(true)
    expect(result.canReadManifest).toBe(true)
  })

  it('private surface allows self reads only (requestor in scope)', () => {
    const result = resolveAccess({
      surfaceId: 'surface-a',
      surfaceClass: 'private',
      visibility: 'self_only',
      revealState: null,
      requestorSurfaceId: 'surface-a',
      allowedReadScopes: ['surface-a'],
      crossSurfaceReads: 'allow',
    })
    expect(result.canRead).toBe(true)
    expect(result.canReadSemantics).toBe(true)
    expect(result.canReadManifest).toBe(true)
    expect(result.reason).toBe('private surface: requestor in scope')
  })

  it('private surface denies other surface reads (requestor not in scope)', () => {
    const result = resolveAccess({
      surfaceId: 'surface-a',
      surfaceClass: 'private',
      visibility: 'self_only',
      revealState: null,
      requestorSurfaceId: 'surface-b',
      allowedReadScopes: ['surface-a'],
      crossSurfaceReads: 'allow',
    })
    expect(result.canRead).toBe(false)
    expect(result.canReadSemantics).toBe(false)
    expect(result.canReadManifest).toBe(true)
    expect(result.reason).toBe('private surface: requestor not in scope')
  })

  it('cross_surface_reads=deny blocks all cross reads when requestor not in scope', () => {
    const result = resolveAccess({
      surfaceId: 'surface-a',
      surfaceClass: 'shared',
      visibility: 'public',
      revealState: null,
      requestorSurfaceId: 'surface-c',
      allowedReadScopes: ['surface-a', 'surface-b'],
      crossSurfaceReads: 'deny',
    })
    expect(result.canRead).toBe(false)
    expect(result.canReadSemantics).toBe(false)
    expect(result.canReadManifest).toBe(false)
    expect(result.reason).toBe('cross_surface_reads=deny and requestor not in scope')
  })

  it('private surface allows self reads even without explicit read scopes', () => {
    const result = resolveAccess({
      surfaceId: 'surface-a',
      surfaceClass: 'private',
      visibility: 'self_only',
      revealState: null,
      requestorSurfaceId: 'surface-a',
      allowedReadScopes: [],
      crossSurfaceReads: 'deny',
    })

    expect(result.canRead).toBe(true)
    expect(result.canReadSemantics).toBe(true)
    expect(result.canReadManifest).toBe(true)
  })

  it('dependency-only access denies cross-surface reads when no explicit read scope is granted', () => {
    const result = resolveAccess({
      surfaceId: 'surface-a',
      surfaceClass: 'shared',
      visibility: 'dependency',
      revealState: 'revealed',
      requestorSurfaceId: 'surface-b',
      allowedReadScopes: [],
      crossSurfaceReads: 'dependency_only',
    })

    expect(result.canRead).toBe(false)
    expect(result.canReadSemantics).toBe(false)
    expect(result.canReadManifest).toBe(true)
    expect(result.reason).toBe('requestor not in dependency scope')
  })
})

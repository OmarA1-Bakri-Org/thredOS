export interface AccessQuery {
  surfaceClass: string
  visibility: string
  revealState: string | null
  requestorSurfaceId: string
  allowedReadScopes: string[]
  crossSurfaceReads: string
}

export interface AccessResult {
  canRead: boolean
  canReadSemantics: boolean
  canReadManifest: boolean
  reason: string
}

export function resolveAccess(query: AccessQuery): AccessResult {
  const { surfaceClass, visibility, revealState, requestorSurfaceId, allowedReadScopes, crossSurfaceReads } = query

  // Sealed + not revealed: manifest only
  if (surfaceClass === 'sealed' && revealState !== 'revealed') {
    return { canRead: false, canReadSemantics: false, canReadManifest: true, reason: 'sealed surface pre-reveal: manifest only' }
  }

  // Cross-surface deny
  if (crossSurfaceReads === 'deny') {
    const inScope = allowedReadScopes.includes(requestorSurfaceId)
    if (!inScope) {
      return { canRead: false, canReadSemantics: false, canReadManifest: false, reason: 'cross_surface_reads=deny and requestor not in scope' }
    }
  }

  // Private: self only
  if (surfaceClass === 'private' && visibility === 'self_only') {
    const inScope = allowedReadScopes.includes(requestorSurfaceId)
    return { canRead: inScope, canReadSemantics: inScope, canReadManifest: true, reason: inScope ? 'private surface: requestor in scope' : 'private surface: requestor not in scope' }
  }

  // Dependency-scoped
  if (crossSurfaceReads === 'dependency_only') {
    const inScope = allowedReadScopes.length === 0 || allowedReadScopes.includes(requestorSurfaceId)
    return { canRead: inScope, canReadSemantics: inScope, canReadManifest: true, reason: inScope ? 'dependency access granted' : 'requestor not in dependency scope' }
  }

  // Default: allow
  return { canRead: true, canReadSemantics: true, canReadManifest: true, reason: 'default access' }
}

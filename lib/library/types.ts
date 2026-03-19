export type LibraryAssetKind = 'prompt' | 'skill' | 'agent'

export interface LibraryAssetLink {
  agentIds: string[]
  nodeIds: string[]
}

export interface LibraryAssetEntry {
  id: string
  kind: LibraryAssetKind
  title: string
  version: number
  path: string
  updatedAt: string
  lastEditor: string | null
  description?: string
  capabilities?: string[]
  links: LibraryAssetLink
}

export interface LibraryCatalog {
  version: 1
  prompts: Record<string, LibraryAssetEntry>
  skills: Record<string, LibraryAssetEntry>
  agents: Record<string, LibraryAssetEntry>
}

export interface SkillRef {
  id: string
  version: number
  path?: string
  capabilities?: string[]
}

export interface PromptRef {
  id: string
  version: number
  path?: string
}


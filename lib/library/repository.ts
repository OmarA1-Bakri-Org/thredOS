import { existsSync } from 'fs'
import { mkdir, readFile, unlink } from 'fs/promises'
import { basename, dirname, extname, join } from 'path'
import YAML from 'yaml'
import { writeFileAtomic } from '@/lib/fs/atomic'
import type { AgentRegistration } from '@/lib/agents/types'
import type { PromptRef, LibraryAssetEntry, LibraryAssetKind, LibraryCatalog, SkillRef } from './types'

const LIBRARY_CATALOG_PATH = '.threados/library.yaml'
const PROMPTS_DIR = '.threados/prompts'
const SKILLS_DIR = '.threados/skills'
const AGENTS_DIR = '.threados/agents'

const DEFAULT_LIBRARY: LibraryCatalog = {
  version: 1,
  prompts: {},
  skills: {},
  agents: {},
}

const DEFAULT_SYSTEM_SKILLS: Array<{
  id: string
  title: string
  description: string
  capabilities: string[]
}> = [
  {
    id: 'search',
    title: 'Search',
    description: 'Research and retrieve information from the web and local knowledge sources.',
    capabilities: ['search'],
  },
  {
    id: 'browser',
    title: 'Browser',
    description: 'Navigate web pages and inspect interactive flows.',
    capabilities: ['browser'],
  },
  {
    id: 'files',
    title: 'Files',
    description: 'Read and work with workspace files and referenced documents.',
    capabilities: ['files'],
  },
  {
    id: 'tools',
    title: 'Tools',
    description: 'Invoke tool-capable workflows and external integrations.',
    capabilities: ['tools'],
  },
  {
    id: 'spawn',
    title: 'Spawn',
    description: 'Authorize the agent to create lower-tier child agents and delegated surfaces.',
    capabilities: ['spawn'],
  },
]

function catalogKey(kind: LibraryAssetKind): 'prompts' | 'skills' | 'agents' {
  return kind === 'prompt' ? 'prompts' : kind === 'skill' ? 'skills' : 'agents'
}

function getCatalogPath(basePath: string): string {
  return join(basePath, LIBRARY_CATALOG_PATH)
}

async function ensureLibraryDirectories(basePath: string): Promise<void> {
  await mkdir(join(basePath, '.threados'), { recursive: true })
  await mkdir(join(basePath, '.threados/runs'), { recursive: true })
  await mkdir(join(basePath, '.threados/state'), { recursive: true })
  await mkdir(join(basePath, PROMPTS_DIR), { recursive: true })
  await mkdir(join(basePath, SKILLS_DIR), { recursive: true })
  await mkdir(join(basePath, AGENTS_DIR), { recursive: true })
}

export function getLibraryAssetPath(basePath: string, kind: LibraryAssetKind, id: string): string {
  if (kind === 'prompt') return join(basePath, PROMPTS_DIR, `${id}.md`)
  if (kind === 'skill') return join(basePath, SKILLS_DIR, id, 'SKILL.md')
  return join(basePath, AGENTS_DIR, id, 'AGENT.md')
}

function emptyLinks() {
  return { agentIds: [], nodeIds: [] }
}

function buildEntry(args: {
  kind: LibraryAssetKind
  id: string
  title: string
  version: number
  path: string
  lastEditor?: string | null
  description?: string
  capabilities?: string[]
  previous?: LibraryAssetEntry
}): LibraryAssetEntry {
  return {
    id: args.id,
    kind: args.kind,
    title: args.title,
    version: args.version,
    path: args.path,
    updatedAt: new Date().toISOString(),
    lastEditor: args.lastEditor ?? null,
    description: args.description ?? args.previous?.description,
    capabilities: args.capabilities ?? args.previous?.capabilities ?? [],
    links: args.previous?.links ?? emptyLinks(),
  }
}

export async function ensureLibraryStructure(basePath: string): Promise<void> {
  await ensureLibraryDirectories(basePath)

  const catalogPath = getCatalogPath(basePath)
  if (!existsSync(catalogPath)) {
    await writeFileAtomic(catalogPath, YAML.stringify(DEFAULT_LIBRARY, { indent: 2 }))
  }

  const catalog = await readLibraryCatalog(basePath)
  let dirty = false
  for (const skill of DEFAULT_SYSTEM_SKILLS) {
    if (!catalog.skills[skill.id]) {
      const path = getLibraryAssetPath(basePath, 'skill', skill.id)
      await mkdir(dirname(path), { recursive: true })
      await writeFileAtomic(path, [
        '---',
        `id: ${skill.id}`,
        `title: ${skill.title}`,
        'version: 1',
        `capabilities: [${skill.capabilities.join(', ')}]`,
        'system: true',
        '---',
        '',
        `# ${skill.title}`,
        '',
        skill.description,
        '',
        '## Intent',
        '',
        'Describe the canonical behavior for this skill here.',
        '',
      ].join('\n'))
      catalog.skills[skill.id] = buildEntry({
        kind: 'skill',
        id: skill.id,
        title: skill.title,
        version: 1,
        path: joinRelativePath(basePath, path),
        description: skill.description,
        capabilities: skill.capabilities,
      })
      dirty = true
    }
  }
  if (dirty) {
    await writeLibraryCatalog(basePath, catalog)
  }
}

export async function readLibraryCatalog(basePath: string): Promise<LibraryCatalog> {
  const fullPath = getCatalogPath(basePath)
  if (!existsSync(fullPath)) {
    await ensureLibraryStructure(basePath)
  }

  const raw = YAML.parse(await readFile(fullPath, 'utf-8')) as Partial<LibraryCatalog> | null
  return {
    version: 1,
    prompts: raw?.prompts ?? {},
    skills: raw?.skills ?? {},
    agents: raw?.agents ?? {},
  }
}

export async function writeLibraryCatalog(basePath: string, catalog: LibraryCatalog): Promise<void> {
  await writeFileAtomic(getCatalogPath(basePath), YAML.stringify({ ...catalog, version: 1 }, { indent: 2 }))
}

export async function listLibraryAssets(basePath: string, kind?: LibraryAssetKind): Promise<LibraryAssetEntry[]> {
  const catalog = await readLibraryCatalog(basePath)
  const lists = kind
    ? Object.values(catalog[catalogKey(kind)])
    : [...Object.values(catalog.prompts), ...Object.values(catalog.skills), ...Object.values(catalog.agents)]
  return lists.sort((a, b) => a.title.localeCompare(b.title))
}

export async function readLibraryAsset(basePath: string, kind: LibraryAssetKind, id: string): Promise<{
  entry: LibraryAssetEntry | null
  content: string | null
}> {
  const catalog = await readLibraryCatalog(basePath)
  const entry = catalog[catalogKey(kind)][id] ?? null
  if (!entry) return { entry: null, content: null }
  const content = await readFile(join(basePath, entry.path), 'utf-8')
  return { entry, content }
}

export async function upsertLibraryAsset(basePath: string, args: {
  kind: LibraryAssetKind
  id: string
  title: string
  content: string
  lastEditor?: string | null
  description?: string
  capabilities?: string[]
  versionBump?: 'major' | 'minor' | 'patch' | 'replace'
}): Promise<LibraryAssetEntry> {
  await ensureLibraryDirectories(basePath)
  const catalogPath = getCatalogPath(basePath)
  if (!existsSync(catalogPath)) {
    await writeFileAtomic(catalogPath, YAML.stringify(DEFAULT_LIBRARY, { indent: 2 }))
  }
  const catalog = await readLibraryCatalog(basePath)
  const bucket = catalog[catalogKey(args.kind)]
  const previous = bucket[args.id]
  const nextVersion = previous ? previous.version + 1 : 1
  const path = getLibraryAssetPath(basePath, args.kind, args.id)
  await mkdir(dirname(path), { recursive: true })
  await writeFileAtomic(path, args.content.endsWith('\n') ? args.content : `${args.content}\n`)

  const entry = buildEntry({
    kind: args.kind,
    id: args.id,
    title: args.title,
    version: nextVersion,
    path: joinRelativePath(basePath, path),
    lastEditor: args.lastEditor,
    description: args.description,
    capabilities: args.capabilities,
    previous,
  })
  bucket[args.id] = entry
  await writeLibraryCatalog(basePath, catalog)
  return entry
}

function joinRelativePath(basePath: string, fullPath: string): string {
  return fullPath
    .replace(`${basePath}\\`, '')
    .replace(`${basePath}/`, '')
    .replaceAll('\\', '/')
}

export async function deleteLibraryAsset(basePath: string, kind: LibraryAssetKind, id: string): Promise<boolean> {
  await ensureLibraryStructure(basePath)
  const catalog = await readLibraryCatalog(basePath)
  const bucket = catalog[catalogKey(kind)]
  const entry = bucket[id]
  if (!entry) return false

  delete bucket[id]
  await writeLibraryCatalog(basePath, catalog)

  const fullPath = join(basePath, entry.path)
  if (existsSync(fullPath)) {
    await unlink(fullPath)
  }
  return true
}

export async function ensurePromptAssetForStep(
  basePath: string,
  stepId: string,
  title: string,
  content?: string,
): Promise<PromptRef> {
  await ensureLibraryStructure(basePath)
  const catalog = await readLibraryCatalog(basePath)
  const existing = catalog.prompts[stepId]
  if (existing) {
    return { id: existing.id, version: existing.version, path: existing.path }
  }

  const entry = await upsertLibraryAsset(basePath, {
    kind: 'prompt',
    id: stepId,
    title,
    content: content ?? `# ${title}\n\nDescribe the task for this node.\n`,
    description: `Canonical prompt asset for ${title}`,
  })
  return { id: entry.id, version: entry.version, path: entry.path }
}

export async function syncAgentAsset(basePath: string, agent: AgentRegistration): Promise<LibraryAssetEntry> {
  const skillLines = (agent.skillRefs ?? []).map(skill => `- ${skill.id}@${skill.version}`).join('\n') || '- none'
  const toolsLines = (agent.tools ?? []).map(tool => `- ${tool}`).join('\n') || '- none'
  const promptLine = agent.promptRef
    ? `- ${agent.promptRef.id}@${agent.promptRef.version}${agent.promptRef.path ? ` (${agent.promptRef.path})` : ''}`
    : '- none'
  const content = [
    '---',
    `id: ${agent.id}`,
    `name: ${agent.name}`,
    `version: ${agent.version ?? 1}`,
    `model: ${agent.model ?? 'unknown'}`,
    `role: ${agent.role ?? 'unspecified'}`,
    `promptRef: ${agent.promptRef?.id ?? ''}`,
    `identityHash: ${agent.composition?.identityHash ?? ''}`,
    '---',
    '',
    `# ${agent.name}`,
    '',
    agent.description ?? 'Canonical registered thredOS agent.',
    '',
    '## Composition',
    '',
    `- Model: ${agent.model ?? 'unknown'}`,
    `- Role: ${agent.role ?? 'unspecified'}`,
    '',
    '## Prompt',
    '',
    promptLine,
    '',
    '## Skills',
    '',
    skillLines,
    '',
    '## Tools',
    '',
    toolsLines,
    '',
  ].join('\n')

  return upsertLibraryAsset(basePath, {
    kind: 'agent',
    id: agent.id,
    title: agent.name,
    content,
    description: agent.description,
  })
}

export function derivePromptTitleFromPath(promptFile: string): string {
  return basename(promptFile, extname(promptFile))
}

export function skillRefFromEntry(entry: LibraryAssetEntry): SkillRef {
  return {
    id: entry.id,
    version: entry.version,
    path: entry.path,
    capabilities: entry.capabilities ?? [],
  }
}

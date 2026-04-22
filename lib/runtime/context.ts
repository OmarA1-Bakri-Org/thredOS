import { mkdir, readFile, writeFile } from 'fs/promises'
import { isAbsolute, resolve } from 'path'
import type { Sequence } from '../sequence/schema'
import { resolvePathWithinBase } from './path-safety'

export type RuntimeContext = Record<string, unknown>

const APOLLO_EXCLUDED_KEYS = ['dnc', 'recently_contacted', 'existing_pipeline', 'special_handling', 'non_omar_owned', 'duplicates'] as const
const APOLLO_PERSONA_LANES = ['A', 'B', 'C', 'D', 'E'] as const

function getRuntimeContextPath(basePath: string): string {
  return resolvePathWithinBase(basePath, '.threados/state/runtime-context.json', 'runtime context path')
}

function isUnsafeRuntimeSegment(segment: string): boolean {
  return segment === '__proto__' || segment === 'prototype' || segment === 'constructor'
}

export function getNestedRuntimeValue(input: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (isUnsafeRuntimeSegment(key)) {
      return undefined
    }
    if (key === 'length' && (Array.isArray(current) || typeof current === 'string')) {
      return current.length
    }
    if (current && typeof current === 'object' && key in (current as Record<string, unknown>)) {
      return (current as Record<string, unknown>)[key]
    }
    return undefined
  }, input)
}

export function setNestedRuntimeValue(target: RuntimeContext, path: string, value: unknown): void {
  const segments = path.split('.').filter(Boolean)
  if (segments.length === 0) return
  if (segments.some(isUnsafeRuntimeSegment)) {
    throw new Error(`runtime context path '${path}' contains a forbidden segment`)
  }

  let current: RuntimeContext = target
  for (const segment of segments.slice(0, -1)) {
    const existing = current[segment]
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      current[segment] = {}
    }
    current = current[segment] as RuntimeContext
  }

  current[segments[segments.length - 1]] = value
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function cloneRuntimeContext<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(item => cloneRuntimeContext(item)) as T
  }
  if (!isPlainObject(value)) return value

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [key, cloneRuntimeContext(nestedValue)]),
  ) as T
}

function mergeRuntimeContexts(target: RuntimeContext, source: RuntimeContext): RuntimeContext {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key]
    if (isPlainObject(existing) && isPlainObject(value)) {
      target[key] = mergeRuntimeContexts({ ...existing }, value)
      continue
    }
    target[key] = cloneRuntimeContext(value)
  }

  return target
}

function normalizeApolloArtifactDir(basePath: string, runtimeContext: RuntimeContext): string | null {
  const configured = typeof runtimeContext.apollo_artifact_dir === 'string' && runtimeContext.apollo_artifact_dir.trim().length > 0
    ? runtimeContext.apollo_artifact_dir.trim()
    : null

  if (!configured) return null
  return isAbsolute(configured)
    ? resolve(configured)
    : resolvePathWithinBase(basePath, configured, 'apollo artifact directory')
}

function resolveApolloArtifactFile(artifactDir: string, fileName: string): string {
  return resolve(artifactDir, fileName)
}

async function readOptionalArtifactObject(path: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(path, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!isPlainObject(parsed)) {
      throw new Error(`Apollo artifact at '${path}' must contain a JSON object`)
    }
    return parsed
  } catch (error) {
    const errno = error as NodeJS.ErrnoException
    if (errno?.code === 'ENOENT') return null
    if (error instanceof SyntaxError) {
      throw new Error(`Failed to parse Apollo artifact at '${path}': ${error.message}`)
    }
    if (error instanceof Error) {
      throw new Error(`Failed to read Apollo artifact at '${path}': ${error.message}`)
    }
    throw error
  }
}

function normalizeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function deriveApolloSourceBucket(source: unknown): 'saved' | 'discovery' | 'both' | null {
  if (typeof source === 'string') {
    const normalized = source.trim().toLowerCase()
    if (normalized.includes('both')) return 'both'
    if (normalized.includes('saved')) return 'saved'
    if (normalized.includes('discover')) return 'discovery'
    return null
  }

  if (Array.isArray(source)) {
    const values = source
      .filter((candidate): candidate is string => typeof candidate === 'string')
      .map(candidate => candidate.trim().toLowerCase())
    const hasSaved = values.some(value => value.includes('saved'))
    const hasDiscovery = values.some(value => value.includes('discover'))
    if (hasSaved && hasDiscovery) return 'both'
    if (hasSaved) return 'saved'
    if (hasDiscovery) return 'discovery'
  }

  return null
}

function deriveApolloApprovalFields(qualifiedSegment: Record<string, unknown>): RuntimeContext {
  const contacts = Array.isArray(qualifiedSegment.contacts)
    ? qualifiedSegment.contacts.filter((candidate): candidate is Record<string, unknown> => isPlainObject(candidate))
    : []

  const counts: RuntimeContext = { saved: 0, discovery: 0, both: 0 }
  for (const lane of APOLLO_PERSONA_LANES) {
    counts[lane] = 0
  }

  for (const contact of contacts) {
    const bucket = deriveApolloSourceBucket(contact.source)
    if (bucket) {
      counts[bucket] = normalizeCount(counts[bucket]) + 1
    }

    const lane = typeof contact.persona_lane === 'string' ? contact.persona_lane.trim().toUpperCase() : ''
    if (APOLLO_PERSONA_LANES.includes(lane as (typeof APOLLO_PERSONA_LANES)[number])) {
      counts[lane] = normalizeCount(counts[lane]) + 1
    }
  }

  const qualified: RuntimeContext = {
    ...qualifiedSegment,
    total_qualified: normalizeCount(qualifiedSegment.total_qualified) || contacts.length,
  }

  const excludedSource = isPlainObject(qualifiedSegment.excluded) ? qualifiedSegment.excluded : {}
  const excluded = Object.fromEntries(
    APOLLO_EXCLUDED_KEYS.map(key => [key, normalizeCount(excludedSource[key])]),
  ) as RuntimeContext

  return {
    qualified_segment: qualified,
    excluded,
    counts,
  }
}

export async function hydrateApolloApprovalRuntimeContext(basePath: string, runtimeContext: RuntimeContext): Promise<RuntimeContext> {
  const hydrated = cloneRuntimeContext(runtimeContext)
  const artifactDir = normalizeApolloArtifactDir(basePath, runtimeContext)

  const [savedContacts, discoveredProspects, qualifiedSegment, enrichedSegment, icpConfig] = artifactDir
      ? await Promise.all([
        readOptionalArtifactObject(resolveApolloArtifactFile(artifactDir, 'saved-contacts.json')),
        readOptionalArtifactObject(resolveApolloArtifactFile(artifactDir, 'discovered-prospects.json')),
        readOptionalArtifactObject(resolveApolloArtifactFile(artifactDir, 'qualified-segment.json')),
        readOptionalArtifactObject(resolveApolloArtifactFile(artifactDir, 'enriched-segment.json')),
        readOptionalArtifactObject(resolveApolloArtifactFile(artifactDir, 'icp-config.json')),
      ])
: [null, null, null, null, null]

  if (savedContacts) {
    mergeRuntimeContexts(hydrated, { saved_contacts: savedContacts })
  }
  if (discoveredProspects) {
    mergeRuntimeContexts(hydrated, { discovered_prospects: discoveredProspects })
  }
  if (qualifiedSegment) {
    mergeRuntimeContexts(hydrated, deriveApolloApprovalFields(qualifiedSegment))
  }
  if (enrichedSegment) {
    mergeRuntimeContexts(hydrated, { enriched_segment: enrichedSegment })
  }
  if (icpConfig) {
    mergeRuntimeContexts(hydrated, { icp_config: icpConfig })
  }

  if (hydrated.resolved_stage_id != null) {
    hydrated.stage_id_or_MISSING = hydrated.resolved_stage_id
  } else if (getNestedRuntimeValue(hydrated, 'icp_config.output.tag_in_apollo') === true) {
    hydrated.stage_id_or_MISSING = 'MISSING'
  }

  return hydrated
}

export async function readRuntimeContext(basePath: string): Promise<RuntimeContext> {
  const runtimeContextPath = getRuntimeContextPath(basePath)

  try {
    const raw = await readFile(runtimeContextPath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Runtime context at '${runtimeContextPath}' must contain a JSON object`)
    }
    return parsed as RuntimeContext
  } catch (error) {
    const errno = error as NodeJS.ErrnoException
    if (errno?.code === 'ENOENT') {
      return {}
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Failed to parse runtime context at '${runtimeContextPath}': ${error.message}`)
    }
    if (error instanceof Error) {
      throw new Error(`Failed to read runtime context at '${runtimeContextPath}': ${error.message}`)
    }
    throw error
  }
}

export async function writeRuntimeContext(basePath: string, context: RuntimeContext): Promise<void> {
  await mkdir(resolvePathWithinBase(basePath, '.threados/state', 'runtime state directory'), { recursive: true })
  await writeFile(getRuntimeContextPath(basePath), `${JSON.stringify(context, null, 2)}\n`, 'utf-8')
}

export async function storeRuntimeContextValue(basePath: string, outputKey: string, value: unknown): Promise<void> {
  const current = await readRuntimeContext(basePath)
  setNestedRuntimeValue(current, outputKey, value)
  await writeRuntimeContext(basePath, current)
}

export function buildConditionContext(sequence: Sequence, context: RuntimeContext): RuntimeContext {
  return {
    ...context,
    first_run: sequence.steps.every(candidate => candidate.status === 'READY' || candidate.status === 'RUNNING'),
  }
}

function parseLiteral(rawLiteral: string): unknown {
  const literal = rawLiteral.trim()

  if (
    (literal.startsWith("'") && literal.endsWith("'"))
    || (literal.startsWith('"') && literal.endsWith('"'))
  ) {
    return literal.slice(1, -1)
  }

  if (literal === 'true') return true
  if (literal === 'false') return false
  if (literal === 'null') return null
  if (/^-?\d+(?:\.\d+)?$/.test(literal)) return Number(literal)

  return undefined
}

export function evaluateRuntimeCondition(expression: string, context: RuntimeContext): boolean {
  const normalized = expression.trim()
  if (!normalized) return true

  const containsMatch = normalized.match(/^([A-Za-z0-9_.]+)\s+contains\s+(.+)$/)
  if (containsMatch) {
    const [, path, rawExpected] = containsMatch
    const expected = parseLiteral(rawExpected)
    const value = getNestedRuntimeValue(context, path)
    if (typeof expected !== 'string') return false
    if (Array.isArray(value)) return value.includes(expected)
    if (typeof value === 'string') return value.includes(expected)
    return false
  }

  const eqMatch = normalized.match(/^([A-Za-z0-9_.]+)\s*==\s*(.+)$/)
  if (eqMatch) {
    const [, path, rawExpected] = eqMatch
    return getNestedRuntimeValue(context, path) === parseLiteral(rawExpected)
  }

  return false
}

export async function evaluateSequenceCondition(basePath: string, sequence: Sequence, expression?: string | null): Promise<boolean> {
  if (typeof expression !== 'string') return true
  const normalized = expression.trim()
  if (!normalized) return true

  const context = buildConditionContext(sequence, await readRuntimeContext(basePath))
  return evaluateRuntimeCondition(normalized, context)
}

import { mkdir, readFile, writeFile } from 'fs/promises'
import { isAbsolute, join } from 'path'
import type { Sequence } from '../sequence/schema'

export type RuntimeContext = Record<string, unknown>

type RuntimeKeyWriteSource = 'native_action_output' | 'apollo_artifact_binding' | 'system'

interface RuntimeContextWriteOptions {
  source?: RuntimeKeyWriteSource
}

const PROTECTED_RUNTIME_KEY_GROUPS = {
  approvalRuntimeInputs: ['apollo_artifact_dir', 'icp_config', 'resolved_stage_id'] as const,
  approvalHydratedValues: ['saved_contacts', 'discovered_prospects', 'qualified_segment', 'enriched_segment', 'counts', 'excluded', 'stage_id_or_MISSING'] as const,
} as const

const PROTECTED_RUNTIME_KEY_ROOTS = [
  ...PROTECTED_RUNTIME_KEY_GROUPS.approvalRuntimeInputs,
  ...PROTECTED_RUNTIME_KEY_GROUPS.approvalHydratedValues,
] as const

const APOLLO_EXCLUDED_KEYS = ['dnc', 'recently_contacted', 'existing_pipeline', 'special_handling', 'non_omar_owned', 'duplicates'] as const
const APOLLO_PERSONA_LANES = ['A', 'B', 'C', 'D', 'E'] as const

function getRuntimeContextPath(basePath: string): string {
  return `${basePath}/.threados/state/runtime-context.json`
}

export function getNestedRuntimeValue(input: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
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

function areRuntimeValuesEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => areRuntimeValuesEqual(value, right[index]))
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    if (leftKeys.length !== rightKeys.length) return false
    return leftKeys.every(key => areRuntimeValuesEqual(left[key], right[key]))
  }

  return left === right
}

function getProtectedRuntimeKeyRoot(path: string): (typeof PROTECTED_RUNTIME_KEY_ROOTS)[number] | null {
  const normalized = path.trim()
  if (!normalized) return null

  for (const root of PROTECTED_RUNTIME_KEY_ROOTS) {
    if (normalized === root || normalized.startsWith(`${root}.`)) {
      return root
    }
  }

  return null
}

function assertWritableRuntimeKey(path: string, options?: RuntimeContextWriteOptions): void {
  const protectedRoot = getProtectedRuntimeKeyRoot(path)
  if (!protectedRoot) return

  const source = options?.source ?? 'system'
  if (source === 'apollo_artifact_binding' && protectedRoot === 'apollo_artifact_dir') {
    return
  }

  throw new Error(`Protected runtime key root '${protectedRoot}' cannot be written by ${source}`)
}

function assertHydratedRuntimeConflict(target: RuntimeContext, key: string, value: unknown): void {
  const existing = target[key]
  if (existing === undefined) return
  if (areRuntimeValuesEqual(existing, value)) return
  throw new Error(`Protected runtime key '${key}' conflicts with hydrated Apollo artifact data`)
}

function mergeHydratedProtectedRuntimeValue(target: RuntimeContext, key: string, value: unknown): void {
  assertHydratedRuntimeConflict(target, key, value)
  mergeRuntimeContexts(target, { [key]: value })
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

function assertRuntimeValue(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

function readOptionalNonEmptyStringRuntimeValue(runtimeContext: RuntimeContext, key: string): string | null {
  const value = runtimeContext[key]
  if (value == null) return null
  assertRuntimeValue(typeof value === 'string' && value.trim().length > 0, `Runtime context value '${key}' must be a non-empty string when provided`)
  return value as string
}

function assertStringArrayRuntimeValue(value: unknown, key: string): asserts value is string[] {
  assertRuntimeValue(
    Array.isArray(value) && value.every(candidate => typeof candidate === 'string'),
    `Runtime context value '${key}' must be an array of strings`,
  )
}

function validateConditionRuntimeValue(context: RuntimeContext, path: string): void {
  if (path === 'first_run') {
    assertRuntimeValue(typeof getNestedRuntimeValue(context, path) === 'boolean', "Runtime context value 'first_run' must be a boolean")
    return
  }

  if (path === 'icp_config.sources' || path === 'icp_config.sources.length') {
    assertStringArrayRuntimeValue(getNestedRuntimeValue(context, 'icp_config.sources'), 'icp_config.sources')
  }
}

function normalizeApolloArtifactDir(basePath: string, runtimeContext: RuntimeContext): string | null {
  const configured = readOptionalNonEmptyStringRuntimeValue(runtimeContext, 'apollo_artifact_dir')
  if (!configured) return null
  return isAbsolute(configured) ? configured : join(basePath, configured)
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
        readOptionalArtifactObject(join(artifactDir, 'saved-contacts.json')),
        readOptionalArtifactObject(join(artifactDir, 'discovered-prospects.json')),
        readOptionalArtifactObject(join(artifactDir, 'qualified-segment.json')),
        readOptionalArtifactObject(join(artifactDir, 'enriched-segment.json')),
        readOptionalArtifactObject(join(artifactDir, 'icp-config.json')),
      ])
    : [null, null, null, null, null]

  if (savedContacts) {
    mergeHydratedProtectedRuntimeValue(hydrated, 'saved_contacts', savedContacts)
  }
  if (discoveredProspects) {
    mergeHydratedProtectedRuntimeValue(hydrated, 'discovered_prospects', discoveredProspects)
  }
  if (qualifiedSegment) {
    const derivedFields = deriveApolloApprovalFields(qualifiedSegment)
    mergeHydratedProtectedRuntimeValue(hydrated, 'qualified_segment', derivedFields.qualified_segment)
    mergeHydratedProtectedRuntimeValue(hydrated, 'excluded', derivedFields.excluded)
    mergeHydratedProtectedRuntimeValue(hydrated, 'counts', derivedFields.counts)
  }
  if (enrichedSegment) {
    mergeHydratedProtectedRuntimeValue(hydrated, 'enriched_segment', enrichedSegment)
  }
  if (icpConfig) {
    mergeHydratedProtectedRuntimeValue(hydrated, 'icp_config', icpConfig)
  }

  if (hydrated.resolved_stage_id != null) {
    assertRuntimeValue(
      typeof hydrated.resolved_stage_id === 'string',
      "Runtime context value 'resolved_stage_id' must be a string or null when provided",
    )
    assertHydratedRuntimeConflict(hydrated, 'stage_id_or_MISSING', hydrated.resolved_stage_id)
    hydrated.stage_id_or_MISSING = hydrated.resolved_stage_id
  } else if (getNestedRuntimeValue(hydrated, 'icp_config.output.tag_in_apollo') === true) {
    assertHydratedRuntimeConflict(hydrated, 'stage_id_or_MISSING', 'MISSING')
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
  await mkdir(`${basePath}/.threados/state`, { recursive: true })
  await writeFile(getRuntimeContextPath(basePath), `${JSON.stringify(context, null, 2)}\n`, 'utf-8')
}

export async function storeRuntimeContextValue(
  basePath: string,
  outputKey: string,
  value: unknown,
  options?: RuntimeContextWriteOptions,
): Promise<void> {
  assertWritableRuntimeKey(outputKey, options)
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
    validateConditionRuntimeValue(context, path)
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
    validateConditionRuntimeValue(context, path)
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

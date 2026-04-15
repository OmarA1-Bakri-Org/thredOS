import { deletePrompt, readPrompt, validatePromptExists, writePrompt } from '@/lib/prompts/manager'
import type { LibraryCatalog } from '@/lib/library/types'
import {
  deleteLibraryAsset,
  ensureLibraryStructure,
  ensurePromptAssetForStep,
  readLibraryCatalog,
  writeLibraryCatalog,
} from '@/lib/library/repository'
import { readSequence, writeSequence } from '@/lib/sequence/parser'
import type { Sequence, Step } from '@/lib/sequence/schema'
import {
  readThreadSurfaceState,
  withThreadSurfaceStateRevision,
  writeThreadSurfaceState,
  type ThreadSurfaceState,
} from '@/lib/thread-surfaces/repository'
import type { ThreadSurface } from '@/lib/thread-surfaces/types'
import { compilePack } from './compiler'
import { loadPack } from './loader'
import type { PackManifest } from './pack-schema'

export interface PackInstallOverrides {
  sourceAssetRef?: string
  parallelTracks?: number
  policyMode?: 'SAFE' | 'POWER'
  modelOverrides?: Record<string, string>
}

export interface PackInstallInput {
  packId: string
  version: string
  installName?: string
  compileOverrides?: PackInstallOverrides
}

export interface PackInstallResult {
  sequence: Sequence
  threadSurfaces: ThreadSurface[]
  installedPack: {
    packId: string
    version: string
    stepCount: number
    surfaceCount: number
  }
}

interface PromptSnapshot {
  catalog: LibraryCatalog
  contents: Map<string, string>
  knownStepIds: Set<string>
}

async function snapshotPrompts(basePath: string, sequence: Sequence): Promise<PromptSnapshot> {
  const contents = new Map<string, string>()
  for (const step of sequence.steps) {
    if (await validatePromptExists(basePath, step.id)) {
      contents.set(step.id, await readPrompt(basePath, step.id))
    }
  }
  return {
    catalog: await readLibraryCatalog(basePath),
    contents,
    knownStepIds: new Set(sequence.steps.map(step => step.id)),
  }
}

async function restorePromptSnapshot(
  basePath: string,
  previous: PromptSnapshot,
  nextStepIds: string[],
): Promise<void> {
  const allStepIds = new Set([...previous.knownStepIds, ...nextStepIds])
  for (const stepId of allStepIds) {
    const previousContent = previous.contents.get(stepId)
    if (previousContent !== undefined) {
      await writePrompt(basePath, stepId, previousContent)
    } else {
      await deletePrompt(basePath, stepId).catch(() => {})
    }
  }
  await writeLibraryCatalog(basePath, previous.catalog)
}

function buildPromptTemplate(manifest: PackManifest, step: Step): string {
  const phaseLine = step.phase ? `Phase: ${step.phase}` : 'Phase: unassigned'
  return [
    `# ${step.name}`,
    '',
    `Pack: ${manifest.name} (${manifest.id}@${manifest.version})`,
    phaseLine,
    '',
    'Describe the task for this node.',
    '',
  ].join('\n')
}

function buildInstalledSequence(input: {
  currentSequence: Sequence
  manifest: PackManifest
  installName?: string
  overrides?: PackInstallOverrides
  steps: Step[]
}): Sequence {
  const { currentSequence, manifest, installName, overrides, steps } = input
  const modelOverrides = overrides?.modelOverrides ?? {}
  const now = new Date().toISOString()

  return {
    id: currentSequence.id,
    version: '1.0',
    name: installName?.trim() || manifest.name,
    thread_type: manifest.thread_types[0],
    steps: steps.map(step => {
      const promptPath = `.threados/prompts/${step.id}.md`
      return {
        ...step,
        model: modelOverrides[step.id] ?? step.model,
        prompt_file: promptPath,
        prompt_ref: {
          id: step.id,
          version: 1,
          path: promptPath,
        },
      }
    }),
    deps: steps.flatMap(step => step.depends_on.map(dep_id => ({ step_id: step.id, dep_id }))),
    gates: [],
    metadata: {
      ...currentSequence.metadata,
      updated_at: now,
    },
    created_at: currentSequence.created_at,
    updated_at: now,
    pack_id: manifest.id,
    pack_version: manifest.version,
    default_policy_ref: overrides?.policyMode ?? manifest.default_policy ?? null,
  }
}

function buildInstalledSurfaceState(
  current: ThreadSurfaceState,
  threadSurfaces: ThreadSurface[],
): ThreadSurfaceState {
  return withThreadSurfaceStateRevision(current, {
    version: 1,
    threadSurfaces,
    runs: [],
    mergeEvents: [],
    runEvents: [],
  })
}

export async function installPack(basePath: string, input: PackInstallInput): Promise<PackInstallResult> {
  await ensureLibraryStructure(basePath)

  const manifest = await loadPack(basePath, input.packId, input.version)
  const compiled = compilePack(manifest)
  const currentSequence = await readSequence(basePath)
  const currentSurfaceState = await readThreadSurfaceState(basePath)
  const promptSnapshot = await snapshotPrompts(basePath, currentSequence)

  const nextSequence = buildInstalledSequence({
    currentSequence,
    manifest,
    installName: input.installName,
    overrides: input.compileOverrides,
    steps: compiled.sequence.steps as Step[],
  })
  const nextSurfaceState = buildInstalledSurfaceState(currentSurfaceState, compiled.surfaces)
  const nextStepIds = nextSequence.steps.map(step => step.id)
  const removedStepIds = currentSequence.steps
    .map(step => step.id)
    .filter(stepId => !nextStepIds.includes(stepId))

  try {
    for (const step of nextSequence.steps) {
      const promptTemplate = buildPromptTemplate(manifest, step)
      await writePrompt(basePath, step.id, promptTemplate)
      const promptRef = await ensurePromptAssetForStep(basePath, step.id, step.name, promptTemplate)
      step.prompt_ref = promptRef
      step.prompt_file = promptRef.path ?? step.prompt_file
    }

    await writeSequence(basePath, nextSequence)
    await writeThreadSurfaceState(basePath, nextSurfaceState)

    for (const stepId of removedStepIds) {
      await deleteLibraryAsset(basePath, 'prompt', stepId).catch(() => {})
      await deletePrompt(basePath, stepId).catch(() => {})
    }
  } catch (error) {
    await writeSequence(basePath, structuredClone(currentSequence)).catch(() => {})
    await writeThreadSurfaceState(basePath, structuredClone(currentSurfaceState)).catch(() => {})
    await restorePromptSnapshot(basePath, promptSnapshot, nextStepIds).catch(() => {})
    throw error
  }

  return {
    sequence: nextSequence,
    threadSurfaces: compiled.surfaces,
    installedPack: {
      packId: manifest.id,
      version: manifest.version,
      stepCount: nextSequence.steps.length,
      surfaceCount: compiled.surfaces.length,
    },
  }
}

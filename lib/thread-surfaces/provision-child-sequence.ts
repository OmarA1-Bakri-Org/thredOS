import { mkdir } from 'fs/promises'
import YAML from 'yaml'
import { writeFileAtomic } from '@/lib/fs/atomic'
import type { TemplateType } from '@/lib/templates'
import { generateBase } from '@/lib/templates/base'
import { generateParallel } from '@/lib/templates/parallel'
import { generateChained } from '@/lib/templates/chained'
import { generateFusion } from '@/lib/templates/fusion'
import { generateOrchestrated } from '@/lib/templates/orchestrated'
import { generateLongAutonomy } from '@/lib/templates/long-autonomy'
import type { Sequence } from '@/lib/sequence/schema'
import {
  assertSafePathSegment,
  resolveExistingPathWithinRoot,
  resolvePathWithinRoot,
} from '@/lib/security/safe-path'

export interface PendingChildSequence {
  surfaceId: string
  sequenceRef: string
  sequenceName: string
  threadType: TemplateType
}

/**
 * Derive the sequence file path for a child surface.
 */
export function deriveChildSequenceRef(surfaceId: string): string {
  assertSafePathSegment(surfaceId, 'surface id')
  return `.threados/sequences/${surfaceId}/sequence.yaml`
}

/**
 * Generate a default sequence from a template type.
 */
function generateSequenceFromTemplate(name: string, threadType: TemplateType): Sequence {
  const templateMap: Record<TemplateType, () => { steps: Sequence['steps']; gates?: Sequence['gates'] }> = {
    'base': () => ({ steps: generateBase() }),
    'parallel': () => ({ steps: generateParallel() }),
    'chained': () => {
      const result = generateChained()
      return { steps: result.steps, gates: result.gates }
    },
    'fusion': () => ({ steps: generateFusion() }),
    'orchestrated': () => ({ steps: generateOrchestrated() }),
    'long-autonomy': () => ({ steps: generateLongAutonomy() }),
  }

  const template = templateMap[threadType]()

  return {
    version: '1.0',
    name,
    steps: template.steps,
    gates: template.gates ?? [],
    metadata: {
      created_at: new Date().toISOString(),
      description: `Child sequence spawned as ${threadType} thread type`,
    },
  }
}

/**
 * Provision a child sequence file on disk.
 *
 * Creates `.threados/sequences/<surfaceId>/sequence.yaml` with the
 * initial sequence definition generated from the specified template type.
 */
export async function provisionChildSequence(
  basePath: string,
  pending: PendingChildSequence,
): Promise<void> {
  const sequence = generateSequenceFromTemplate(pending.sequenceName, pending.threadType)
  const expectedRef = deriveChildSequenceRef(pending.surfaceId)
  if (pending.sequenceRef !== expectedRef) {
    throw new Error('sequence ref must match the canonical child sequence path')
  }
  const threadosPath = await resolvePathWithinRoot(basePath, '.threados')
  await mkdir(threadosPath, { recursive: true })
  const threadosRoot = await resolveExistingPathWithinRoot(basePath, '.threados')
  const sequencesPath = await resolvePathWithinRoot(threadosRoot, 'sequences')
  await mkdir(sequencesPath, { recursive: true })
  const sequencesRoot = await resolveExistingPathWithinRoot(threadosRoot, 'sequences')
  const surfaceDirectory = await resolvePathWithinRoot(sequencesRoot, pending.surfaceId)
  await mkdir(surfaceDirectory, { recursive: true })
  const verifiedSurfaceDirectory = await resolveExistingPathWithinRoot(sequencesRoot, pending.surfaceId)
  const fullPath = await resolvePathWithinRoot(verifiedSurfaceDirectory, 'sequence.yaml')
  await writeFileAtomic(fullPath, YAML.stringify(sequence, { indent: 2 }))
}

/**
 * Provision all pending child sequences.
 */
export async function provisionAllChildSequences(
  basePath: string,
  pending: PendingChildSequence[],
): Promise<void> {
  await Promise.all(pending.map(p => provisionChildSequence(basePath, p)))
}

import YAML from 'yaml'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { SequenceSchema, type Sequence } from './schema'
import { writeFileAtomic } from '../fs/atomic'
import { SequenceValidationError, ThredOSError } from '../errors'

const SEQUENCE_PATH = '.threados/sequence.yaml'

const SEQUENCE_REVISION = Symbol('threados.sequenceRevision')

type SequenceWithRevision = Sequence & {
  [SEQUENCE_REVISION]?: string | null
}

/** Default empty sequence returned when no sequence.yaml exists */
function createDefaultSequence(): Sequence {
  return {
    version: '1.0',
    name: 'New Sequence',
    steps: [],
    gates: [],
    metadata: {
      created_at: new Date().toISOString(),
      description: 'Default empty sequence',
    },
  }
}

function attachRevision<T extends Sequence>(sequence: T, revision: string | null): T {
  Object.defineProperty(sequence, SEQUENCE_REVISION, {
    value: revision,
    enumerable: true,
    configurable: true,
    writable: true,
  })
  return sequence
}

async function readCurrentRevision(fullPath: string): Promise<string | null> {
  if (!existsSync(fullPath)) {
    return null
  }
  return readFile(fullPath, 'utf-8')
}

/**
 * Read and validate sequence.yaml from the given base path.
 * Returns a default empty sequence if the file does not exist.
 *
 * @param basePath - The root directory containing .threados/
 * @returns The validated Sequence object
 * @throws SequenceValidationError if validation fails
 */
export async function readSequence(basePath: string): Promise<Sequence> {
  const fullPath = join(basePath, SEQUENCE_PATH)

  if (!existsSync(fullPath)) {
    return attachRevision(createDefaultSequence(), null)
  }

  const content = await readFile(fullPath, 'utf-8')
  const raw = YAML.parse(content)

  // Validate with Zod - throw on invalid data so corruption is surfaced
  const result = SequenceSchema.safeParse(raw)
  if (!result.success) {
    throw new SequenceValidationError(result.error)
  }
  return attachRevision(result.data, content)
}

/**
 * Validate and atomically write sequence.yaml to the given base path
 *
 * @param basePath - The root directory containing .threados/
 * @param sequence - The sequence object to write
 * @throws SequenceValidationError if validation fails
 */
export async function writeSequence(
  basePath: string,
  sequence: Sequence
): Promise<void> {
  const fullPath = join(basePath, SEQUENCE_PATH)
  const currentRevision = await readCurrentRevision(fullPath)
  const expectedRevision = (sequence as SequenceWithRevision)[SEQUENCE_REVISION]

  if (expectedRevision !== undefined && currentRevision !== expectedRevision) {
    throw new ThredOSError(
      'Sequence was modified concurrently. Reload the latest workflow state and retry your change.',
      'SEQUENCE_CONFLICT'
    )
  }

  // Validate before writing
  const result = SequenceSchema.safeParse(sequence)
  if (!result.success) {
    throw new SequenceValidationError(result.error)
  }

  const content = YAML.stringify(result.data, { indent: 2 })
  await writeFileAtomic(fullPath, content)
  attachRevision(sequence, content)
}
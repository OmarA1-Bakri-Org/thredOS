import YAML from 'yaml'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { SequenceSchema, type Sequence } from './schema'
import { writeFileAtomic } from '../fs/atomic'
import { SequenceValidationError } from '../errors'

const SEQUENCE_PATH = '.threados/sequence.yaml'

/** Default empty sequence returned when no sequence.yaml exists */
const DEFAULT_SEQUENCE: Sequence = {
  version: '1.0',
  name: 'New Sequence',
  steps: [],
  gates: [],
  metadata: {
    created_at: new Date().toISOString(),
    description: 'Default empty sequence',
  },
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
    return DEFAULT_SEQUENCE
  }

  const content = await readFile(fullPath, 'utf-8')
  const raw = YAML.parse(content)

  // Validate with Zod - throw on invalid data so corruption is surfaced
  const result = SequenceSchema.safeParse(raw)
  if (!result.success) {
    throw new SequenceValidationError(result.error)
  }
  return result.data
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

  // Validate before writing
  const result = SequenceSchema.safeParse(sequence)
  if (!result.success) {
    throw new SequenceValidationError(result.error)
  }

  const content = YAML.stringify(result.data, { indent: 2 })
  await writeFileAtomic(fullPath, content)
}

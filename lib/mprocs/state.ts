import { readFile } from 'fs/promises'
import { join } from 'path'
import { writeFileAtomic } from '../fs/atomic'

// Legacy compatibility/observability only: stepId -> mprocs processIndex.
// Canonical V2 runtime recovery never uses this map as process truth.
export type MprocsMap = Record<string, number>

const MPROCS_MAP_PATH = '.threados/state/mprocs-map.json'

/**
 * Read the mprocs map from .threados/state/mprocs-map.json
 *
 * @param basePath - The root directory containing .threados/
 * @returns The mprocs map (stepId -> processIndex)
 */
export async function readMprocsMap(basePath: string): Promise<MprocsMap> {
  const fullPath = join(basePath, MPROCS_MAP_PATH)

  try {
    const content = await readFile(fullPath, 'utf-8')
    return JSON.parse(content) as MprocsMap
  } catch (error) {
    // Return empty map if file doesn't exist
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}
    }
    throw error
  }
}

/**
 * Write the mprocs map atomically to .threados/state/mprocs-map.json
 *
 * @param basePath - The root directory containing .threados/
 * @param map - The mprocs map to write
 */
export async function writeMprocsMap(
  basePath: string,
  map: MprocsMap
): Promise<void> {
  const fullPath = join(basePath, MPROCS_MAP_PATH)
  const content = JSON.stringify(map, null, 2)
  await writeFileAtomic(fullPath, content)
}

/**
 * Update a single step's process index in the mprocs map
 *
 * @param basePath - The root directory containing .threados/
 * @param stepId - The step ID to update
 * @param processIndex - The mprocs process index
 */
export async function updateStepProcess(
  basePath: string,
  stepId: string,
  processIndex: number
): Promise<void> {
  const map = await readMprocsMap(basePath)
  map[stepId] = processIndex
  await writeMprocsMap(basePath, map)
}

/**
 * Remove a step from the mprocs map
 *
 * @param basePath - The root directory containing .threados/
 * @param stepId - The step ID to remove
 */
export async function removeStepProcess(
  basePath: string,
  stepId: string
): Promise<void> {
  const map = await readMprocsMap(basePath)
  delete map[stepId]
  await writeMprocsMap(basePath, map)
}

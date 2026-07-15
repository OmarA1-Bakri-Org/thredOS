import { readdir, access, mkdir } from 'fs/promises'
import { join, basename, extname } from 'path'
import { writeFileAtomic } from '../fs/atomic'
import {
  assertSafePathSegment,
  resolveExistingPathWithinRoot,
  resolvePathWithinRoot,
} from '../security/safe-path'
import { readTextFileNoFollow } from '../security/safe-io'

const PROMPTS_PATH = '.threados/prompts'

async function getPromptsRoot(basePath: string, create: boolean): Promise<string> {
  if (!create) {
    const threadosRoot = await resolveExistingPathWithinRoot(basePath, '.threados')
    return await resolveExistingPathWithinRoot(threadosRoot, 'prompts')
  }

  const threadosPath = await resolvePathWithinRoot(basePath, '.threados')
  await mkdir(threadosPath, { recursive: true })
  const threadosRoot = await resolveExistingPathWithinRoot(basePath, '.threados')
  const promptsPath = await resolvePathWithinRoot(threadosRoot, 'prompts')
  await mkdir(promptsPath, { recursive: true })
  return await resolveExistingPathWithinRoot(threadosRoot, 'prompts')
}

/**
 * Read a prompt file for a step
 *
 * @param basePath - The root directory containing .threados/
 * @param stepId - The step ID
 * @returns The prompt content
 */
export async function readPrompt(
  basePath: string,
  stepId: string
): Promise<string> {
  assertSafePathSegment(stepId, 'step id')
  const promptsRoot = await getPromptsRoot(basePath, false)
  const filePath = await resolveExistingPathWithinRoot(promptsRoot, `${stepId}.md`)
  return readTextFileNoFollow(filePath)
}

/**
 * Write a prompt file for a step
 *
 * @param basePath - The root directory containing .threados/
 * @param stepId - The step ID
 * @param content - The prompt content
 */
export async function writePrompt(
  basePath: string,
  stepId: string,
  content: string
): Promise<void> {
  assertSafePathSegment(stepId, 'step id')
  const promptsRoot = await getPromptsRoot(basePath, true)
  const filePath = await resolvePathWithinRoot(promptsRoot, `${stepId}.md`)
  await writeFileAtomic(filePath, content)
}

/**
 * List all prompt files
 *
 * @param basePath - The root directory containing .threados/
 * @returns Array of step IDs that have prompt files
 */
export async function listPrompts(basePath: string): Promise<string[]> {
  try {
    const promptsDir = await getPromptsRoot(basePath, false)
    const files = await readdir(promptsDir)
    return files
      .filter(file => extname(file) === '.md')
      .map(file => basename(file, '.md'))
      .filter(file => {
        try {
          assertSafePathSegment(file, 'step id')
          return true
        } catch {
          return false
        }
      })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }
}

/**
 * Check if a prompt file exists for a step
 *
 * @param basePath - The root directory containing .threados/
 * @param stepId - The step ID
 * @returns True if the prompt file exists
 */
export async function validatePromptExists(
  basePath: string,
  stepId: string
): Promise<boolean> {
  assertSafePathSegment(stepId, 'step id')

  try {
    const promptsRoot = await getPromptsRoot(basePath, false)
    const filePath = await resolveExistingPathWithinRoot(promptsRoot, `${stepId}.md`)
    await access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Delete a prompt file
 *
 * @param basePath - The root directory containing .threados/
 * @param stepId - The step ID
 */
export async function deletePrompt(
  basePath: string,
  stepId: string
): Promise<void> {
  const { unlink } = await import('fs/promises')
  assertSafePathSegment(stepId, 'step id')
  const promptsRoot = await getPromptsRoot(basePath, false)
  const filePath = await resolveExistingPathWithinRoot(promptsRoot, `${stepId}.md`)
  await unlink(filePath)
}

/**
 * Get the path to a prompt file
 *
 * @param basePath - The root directory containing .threados/
 * @param stepId - The step ID
 * @returns The full path to the prompt file
 */
export function getPromptPath(basePath: string, stepId: string): string {
  assertSafePathSegment(stepId, 'step id')
  return join(basePath, PROMPTS_PATH, `${stepId}.md`)
}

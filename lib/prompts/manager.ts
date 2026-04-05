import { readFile, readdir, access } from 'fs/promises'
import { join, basename, extname } from 'path'
import { writeFileAtomic } from '../fs/atomic'

const PROMPTS_PATH = '.threados/prompts'

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
  const filePath = join(basePath, PROMPTS_PATH, `${stepId}.md`)
  return readFile(filePath, 'utf-8')
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
  const filePath = join(basePath, PROMPTS_PATH, `${stepId}.md`)
  await writeFileAtomic(filePath, content)
}

/**
 * List all prompt files
 *
 * @param basePath - The root directory containing .threados/
 * @returns Array of step IDs that have prompt files
 */
export async function listPrompts(basePath: string): Promise<string[]> {
  const promptsDir = join(basePath, PROMPTS_PATH)

  try {
    const files = await readdir(promptsDir)
    return files
      .filter(file => extname(file) === '.md')
      .map(file => basename(file, '.md'))
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
  const filePath = join(basePath, PROMPTS_PATH, `${stepId}.md`)

  try {
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
  const filePath = join(basePath, PROMPTS_PATH, `${stepId}.md`)
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
  return join(basePath, PROMPTS_PATH, `${stepId}.md`)
}

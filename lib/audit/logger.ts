import { appendFile, readFile, mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import { AuditEntrySchema, type AuditEntry, type AuditReadOptions } from './schema'

const AUDIT_LOG_PATH = '.threados/audit.log'

const SECRET_PATTERN = /\b(password|secret|token|key|api[_-]?key|auth|credentials|private[_-]?key|access[_-]?token|bearer)\s*[=:]\s*\S+/gi

/**
 * Redact secrets from a string
 */
export function redactSecrets(input: string): string {
  return input.replace(SECRET_PATTERN, (match) => {
    const sepIndex = match.search(/[=:]/)
    return match.substring(0, sepIndex + 1) + '[REDACTED]'
  })
}

/**
 * Deep redact secrets from an object
 */
function redactObject(obj: unknown): unknown {
  if (typeof obj === 'string') return redactSecrets(obj)
  if (Array.isArray(obj)) return obj.map(redactObject)
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      result[k] = redactObject(v)
    }
    return result
  }
  return obj
}

/**
 * Append an audit entry to the log file
 */
export async function log(basePath: string, entry: AuditEntry): Promise<void> {
  const parsed = AuditEntrySchema.parse(entry)
  const redacted = redactObject(parsed) as AuditEntry
  const filePath = join(basePath, AUDIT_LOG_PATH)
  await mkdir(dirname(filePath), { recursive: true })
  await appendFile(filePath, JSON.stringify(redacted) + '\n', 'utf-8')
}

/**
 * Read audit entries with optional pagination
 */
export async function read(basePath: string, options?: AuditReadOptions): Promise<AuditEntry[]> {
  const filePath = join(basePath, AUDIT_LOG_PATH)
  let content: string
  try {
    content = await readFile(filePath, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  const lines = content.trim().split('\n').filter(Boolean)
  let entries = lines.map(line => JSON.parse(line) as AuditEntry)

  const offset = options?.offset ?? 0
  const limit = options?.limit ?? entries.length
  entries = entries.slice(offset, offset + limit)

  return entries
}

/**
 * Read all audit entries from the log file
 */
export async function readAll(basePath: string): Promise<AuditEntry[]> {
  return read(basePath)
}

/**
 * Get the last n audit entries
 */
export async function tail(basePath: string, n: number): Promise<AuditEntry[]> {
  const filePath = join(basePath, AUDIT_LOG_PATH)
  let content: string
  try {
    content = await readFile(filePath, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  const lines = content.trim().split('\n').filter(Boolean)
  const entries = lines.slice(-n).map(line => JSON.parse(line) as AuditEntry)
  return entries
}

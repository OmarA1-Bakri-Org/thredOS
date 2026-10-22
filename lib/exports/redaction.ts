import { redactSecrets } from '../audit/logger'
import { assertSafePathSegment } from '../security/safe-path'
import { hashSha256Bytes } from '../workspaces/hash'

const DIGEST = /^sha256:[a-f0-9]{64}$/
const WINDOWS_PATH = /(?:[A-Za-z]:[\\/]|\\\\)[^\s'"`,;)}\]]+/g
const POSIX_PATH = /(^|[\s='"`(])\/(?:[^\s'"`,;)}\]]+)/g

export function redactExportText(value: string): string {
  return redactSecrets(value)
    .replace(WINDOWS_PATH, '[redacted]')
    .replace(POSIX_PATH, '$1[redacted]')
}

export function exportEvidenceReference(value: string): string {
  if (DIGEST.test(value)) return value
  try {
    return assertSafePathSegment(value, 'evidence reference')
  } catch {
    // A structured run-local path is useful to a reviewer, but unknown paths
    // may carry private project names or sibling workspace information.
  }
  // Paths, including run-local relative paths, can contain agent-controlled
  // filenames and sibling surface names. Keep only a stable digest.
  return hashSha256Bytes(value)
}

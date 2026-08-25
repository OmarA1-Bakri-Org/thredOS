import { readFile, readdir, stat, writeFile } from 'fs/promises'
import { join } from 'path'

export const REQUIRED_M0_PROOF_FILES = [
  'api-run-tree.txt',
  'cli-run-tree.txt',
  'parity.json',
  'process-cancel.json',
  'retry-lineage.json',
  'recovery-report.json',
  'architecture-boundary-report.json',
  'test-results.txt',
  'build-results.txt',
] as const

export const RUNTIME_LIFECYCLE_HANDLERS = [
  'app/api/run/route.ts',
  'app/api/stop/route.ts',
  'app/api/restart/route.ts',
  'app/api/status/route.ts',
  'app/api/runs/route.ts',
  'app/api/runs/[runId]/route.ts',
  'app/api/runs/[runId]/attempts/route.ts',
  'app/api/runs/[runId]/cancel/route.ts',
  'app/api/attempts/[attemptId]/route.ts',
  'app/api/attempts/[attemptId]/cancel/route.ts',
  'app/api/attempts/[attemptId]/retry/route.ts',
  'lib/seqctl/commands/run.ts',
  'lib/seqctl/commands/control.ts',
  'lib/seqctl/commands/status.ts',
  'lib/seqctl/commands/attempt.ts',
] as const

const FORBIDDEN_IMPORTS = [
  /(?:@\/|\.\.\/)+(?:lib\/)?runner\/(?:wrapper|dispatch|artifacts|prompt-compiler|process-handle)/,
  /(?:@\/|\.\.\/)+(?:lib\/)?runtime\/(?:attempt-executor|process-controller|lifecycle|scheduler)/,
  /(?:@\/|\.\.\/)+(?:lib\/)?mprocs\//,
  /(?:@\/|\.\.\/)+(?:lib\/)?thread-surfaces\/(?:mutations|step-run-runtime|repository)/,
  /(?:@\/|\.\.\/)+(?:lib\/)?reconciliation\//,
  /(?:@\/|\.\.\/)+(?:lib\/)?gates\/(?:engine|rules)/,
  /(?:@\/|\.\.\/)+(?:lib\/)?approvals\//,
] as const

const FORBIDDEN_LIFECYCLE_CALLS = [
  /\b(?:transitionRun|transitionAttempt|transitionProcess)\s*\(/,
  /\b(?:startProcess|runStep|dispatch|executeStep)\s*\(/,
  /\b(?:writeSequence|writeThreadSurfaceState)\s*\(/,
  /\bnew\s+(?:RunRepository|AttemptRepository|ProcessRepository|SequentialScheduler)\b/,
] as const

export interface M0ProofBundleValidation {
  valid: boolean
  missing: string[]
  empty: string[]
}

export function withoutThreadOSBasePath<
  Environment extends Record<string, string | undefined>,
>(
  environment: Environment,
): Environment {
  const sanitized = { ...environment }
  delete sanitized.THREDOS_BASE_PATH
  delete sanitized.THREADOS_BASE_PATH
  return sanitized as Environment
}

export async function validateM0ProofBundle(
  proofRoot: string,
): Promise<M0ProofBundleValidation> {
  const missing: string[] = []
  const empty: string[] = []

  for (const fileName of REQUIRED_M0_PROOF_FILES) {
    const filePath = join(proofRoot, fileName)
    const details = await stat(filePath).catch(() => null)
    if (!details?.isFile()) {
      missing.push(fileName)
    } else if (details.size === 0) {
      empty.push(fileName)
    }
  }

  return {
    valid: missing.length === 0 && empty.length === 0,
    missing,
    empty,
  }
}

export function verificationTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-')
}

export async function writeProofJson(
  filePath: string,
  value: unknown,
): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export async function listCanonicalFiles(
  root: string,
  relative = '',
): Promise<string[]> {
  const directory = join(root, relative)
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const files: string[] = []

  for (const entry of entries) {
    const child = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      files.push(...await listCanonicalFiles(root, child))
    } else if (entry.isFile() && !entry.name.endsWith('.lock')) {
      files.push(child.replaceAll('\\', '/'))
    }
  }

  return files.sort()
}

export function normalizeProofValue(
  value: unknown,
  basePath: string,
  key = '',
): unknown {
  if (key === 'created_via') return '<interface>'
  if (key === 'request_hash') return '<interface-request-hash>'
  if (typeof value === 'string') {
    return value
      .replaceAll(basePath, '<ROOT>')
      .replaceAll(basePath.replaceAll('\\', '/'), '<ROOT>')
      .replaceAll('runtime:cli', 'runtime:<interface>')
      .replaceAll('runtime:api', 'runtime:<interface>')
  }
  if (Array.isArray(value)) {
    return value.map(item => normalizeProofValue(item, basePath))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [
      childKey,
      normalizeProofValue(child, basePath, childKey),
    ]))
  }
  return value
}

export async function readCanonicalRuntimeTree(basePath: string): Promise<{
  topology: string[]
  records: Record<string, unknown>
}> {
  const root = join(basePath, '.threados')
  const topology = (await listCanonicalFiles(root)).filter(path =>
    path.startsWith('runs/')
    || path.startsWith('state/runtime-commands/')
    || path === 'state/runtime-index.json'
    || path.includes('thread-surface')
    || path.includes('gate-decision')
    || path.includes('trace')
    || path.includes('approval'),
  )
  const records: Record<string, unknown> = {}

  for (const path of topology) {
    const raw = await readFile(join(root, ...path.split('/')), 'utf8')
    if (path.endsWith('.json')) {
      records[path] = normalizeProofValue(JSON.parse(raw), basePath)
    } else if (path.endsWith('.ndjson')) {
      records[path] = raw.trim().split('\n').filter(Boolean)
        .map(line => normalizeProofValue(JSON.parse(line), basePath))
    } else {
      records[path] = normalizeProofValue(raw, basePath)
    }
  }

  return { topology, records }
}

export async function scanRuntimeServiceBoundary(repositoryRoot: string): Promise<{
  passed: boolean
  handlersScanned: string[]
  violations: Array<{
    file: string
    category: 'forbidden-import' | 'forbidden-lifecycle-call' | 'missing-runtime-service'
    pattern: string
  }>
}> {
  const violations: Array<{
    file: string
    category: 'forbidden-import' | 'forbidden-lifecycle-call' | 'missing-runtime-service'
    pattern: string
  }> = []

  for (const relativePath of RUNTIME_LIFECYCLE_HANDLERS) {
    const source = await readFile(join(repositoryRoot, relativePath), 'utf8')
    for (const pattern of FORBIDDEN_IMPORTS) {
      if (pattern.test(source)) {
        violations.push({
          file: relativePath,
          category: 'forbidden-import',
          pattern: pattern.source,
        })
      }
    }
    for (const pattern of FORBIDDEN_LIFECYCLE_CALLS) {
      if (pattern.test(source)) {
        violations.push({
          file: relativePath,
          category: 'forbidden-lifecycle-call',
          pattern: pattern.source,
        })
      }
    }
    if (relativePath.startsWith('app/api/') && !source.includes('getApiRuntimeService')) {
      violations.push({
        file: relativePath,
        category: 'missing-runtime-service',
        pattern: 'getApiRuntimeService',
      })
    }
    if (relativePath.startsWith('lib/seqctl/') && !source.includes('getCLIRuntimeService')) {
      violations.push({
        file: relativePath,
        category: 'missing-runtime-service',
        pattern: 'getCLIRuntimeService',
      })
    }
  }

  return {
    passed: violations.length === 0,
    handlersScanned: [...RUNTIME_LIFECYCLE_HANDLERS],
    violations,
  }
}

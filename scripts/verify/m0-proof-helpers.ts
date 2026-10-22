import { readFile, readdir, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import {
  loadRuntimeLifecycleFileRecords,
  requiredSignalsForClassification,
  RUNTIME_LIFECYCLE_INTERFACE_CLASSIFICATIONS,
  RUNTIME_LIFECYCLE_INTERFACE_ROOTS,
  shouldApplyDelegateOwnershipChecks,
  type RuntimeLifecycleFileSystem,
  type RuntimeLifecycleTraversalError,
} from './runtime-lifecycle-interfaces'

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

export const RUNTIME_LIFECYCLE_HANDLERS = RUNTIME_LIFECYCLE_INTERFACE_CLASSIFICATIONS
  .map(classification => classification.file)

export type RuntimeServiceBoundaryViolationCategory =
  | 'forbidden-import'
  | 'forbidden-lifecycle-call'
  | 'missing-runtime-service'
  | 'missing-policy-signal'
  | 'unclassified-lifecycle'
  | 'missing-classified-interface'
  | 'interface-traversal-error'

export interface RuntimeServiceBoundaryViolation {
  file: string
  category: RuntimeServiceBoundaryViolationCategory
  pattern: string
}

export interface RuntimeServiceBoundaryReport {
  passed: boolean
  handlersScanned: string[]
  discoveredFiles: string[]
  candidateFiles: string[]
  classifiedFiles: string[]
  unclassifiedCandidates: string[]
  missingClassifiedFiles: string[]
  traversalErrors: RuntimeLifecycleTraversalError[]
  violations: RuntimeServiceBoundaryViolation[]
}

export interface RuntimeServiceBoundaryScanOptions {
  roots?: readonly string[]
  filesystem?: RuntimeLifecycleFileSystem
  classifications?: readonly {
    file: string
    kind: 'api-delegate' | 'cli-delegate' | 'chat-runtime-controls-rejected'
    policy: 'delegate-to-runtime-service' | 'reject-runtime-controls'
    requiredSignals?: readonly (
      | 'api-runtime-service'
      | 'api-runtime-service-reference'
      | 'cli-runtime-service'
      | 'cli-runtime-service-reference'
      | 'chat-action-validator'
      | 'chat-runtime-control-guard'
      | 'chat-runtime-control-definition'
    )[]
  }[]
}

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
  if (key === 'ts' || key.endsWith('_at')) return value == null ? null : '<timestamp>'
  if (key === 'workspace_id') return value == null ? null : '<workspace-id>'
  if (key === 'snapshot_id' || key === 'baseline_snapshot_id') {
    return value == null ? null : '<snapshot-id>'
  }
  if (typeof value === 'string') {
    if (key === 'cwd' && /[\\/]thredOS[\\/](?:runtime[\\/])?workspaces[\\/]/i.test(value)) {
      return '<workspace-root>'
    }
    return value
      .replaceAll(basePath, '<ROOT>')
      .replaceAll(basePath.replaceAll('\\', '/'), '<ROOT>')
      .replaceAll('runtime:cli', 'runtime:<interface>')
      .replaceAll('runtime:api', 'runtime:<interface>')
      .replace(/workspace-[0-9a-f-]{36}/g, '<workspace-id>')
      .replace(/snapshot-[0-9a-f-]{36}/g, '<snapshot-id>')
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

export async function scanRuntimeServiceBoundary(
  repositoryRoot: string,
  options: RuntimeServiceBoundaryScanOptions = {},
): Promise<RuntimeServiceBoundaryReport> {
  const classifications = options.classifications ?? RUNTIME_LIFECYCLE_INTERFACE_CLASSIFICATIONS
  const violations: RuntimeServiceBoundaryViolation[] = []
  const loadResult = await loadRuntimeLifecycleFileRecords(
    repositoryRoot,
    options.roots ?? RUNTIME_LIFECYCLE_INTERFACE_ROOTS,
    options.filesystem,
  )
  const discoveredRecords = loadResult.records
  const traversalErrors = loadResult.traversalErrors
  const discoveredFiles = discoveredRecords.map(record => record.file)
  const sourceByFile = new Map(discoveredRecords.map(record => [record.file, record]))
  const classificationByFile = new Map(classifications.map(classification => [classification.file, classification]))
  const classifiedFiles = classifications.map(classification => classification.file)
  const candidateSignalsByFile = new Map<string, string[]>()

  for (const record of discoveredRecords) {
    for (const violation of record.globalViolations) {
      violations.push({
        file: record.file,
        category: violation.category,
        pattern: violation.pattern,
      })
    }
    const classification = classificationByFile.get(record.file)
    if (shouldApplyDelegateOwnershipChecks(classification, record.signals)) {
      for (const violation of record.delegateViolations) {
        violations.push({
          file: record.file,
          category: violation.category,
          pattern: violation.pattern,
        })
      }
    }
    const candidatePatterns = record.candidatePatterns
    if (candidatePatterns.length > 0) {
      candidateSignalsByFile.set(record.file, candidatePatterns)
    }
  }

  for (const traversalError of traversalErrors) {
    violations.push({
      file: traversalError.path,
      category: 'interface-traversal-error',
      pattern: traversalError.code,
    })
  }

  const candidateFiles = [...candidateSignalsByFile.keys()].sort()
  const missingClassifiedFiles = classifications
    .map(classification => classification.file)
    .filter(file => !sourceByFile.has(file))
    .sort()

  for (const file of missingClassifiedFiles) {
    violations.push({
      file,
      category: 'missing-classified-interface',
      pattern: 'classified-file-missing',
    })
  }

  const unclassifiedCandidates = candidateFiles
    .filter(file => !classifiedFiles.includes(file))
    .sort()

  for (const file of unclassifiedCandidates) {
    const signals = candidateSignalsByFile.get(file) ?? []
    violations.push({
      file,
      category: 'unclassified-lifecycle',
      pattern: signals[0] ?? 'candidate-signal',
    })
  }

  for (const classification of classifications) {
    const record = sourceByFile.get(classification.file)
    if (!record) continue
    const signals = new Set(record.signals)
    for (const requiredSignal of requiredSignalsForClassification(classification)) {
      if (signals.has(requiredSignal)) continue
      violations.push({
        file: classification.file,
        category: classification.kind === 'chat-runtime-controls-rejected'
          ? 'missing-policy-signal'
          : 'missing-runtime-service',
        pattern: requiredSignal,
      })
    }
  }

  return {
    passed: violations.length === 0 && traversalErrors.length === 0,
    handlersScanned: [...classifiedFiles],
    discoveredFiles,
    candidateFiles,
    classifiedFiles: [...classifiedFiles],
    unclassifiedCandidates,
    missingClassifiedFiles,
    traversalErrors,
    violations,
  }
}

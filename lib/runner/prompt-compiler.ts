import { readFile, readdir, stat } from 'fs/promises'
import { join } from 'path'
import type { Step, Sequence } from '../sequence/schema'

export interface CompileOptions {
  stepId: string
  step: Step
  rawPrompt: string
  sequence: Sequence
  basePath: string
  maxTokens?: number
  runtimeEventLogPath?: string
  runtimeEventEmitterCommand?: string
}

interface DependencyArtifact {
  stepId: string
  stdout: string
  duration?: number
}

const DEFAULT_MAX_TOKENS = 8000
const CHARS_PER_TOKEN = 4 // rough estimate

/**
 * Compile a raw prompt with execution context for agent dispatch.
 *
 * Injects: sequence state, dependency outputs, project context,
 * constraints, and thread-type-specific instructions.
 */
export async function compilePrompt(opts: CompileOptions): Promise<string> {
  const { stepId, step, rawPrompt, sequence, basePath } = opts
  const maxChars = (opts.maxTokens ?? DEFAULT_MAX_TOKENS) * CHARS_PER_TOKEN

  const sections: string[] = []

  sections.push(buildHeaderSection(step, stepId))
  sections.push(buildThreadTypeSection(step, sequence))
  sections.push(buildTaskSection(rawPrompt))
  sections.push(buildSequenceStateSection(stepId, sequence))
  sections.push(await buildArtifactsSection(step, sequence, basePath, maxChars))
  sections.push(buildWorkingDirSection(step, basePath))
  sections.push(await buildFileTreeSection(basePath))
  sections.push(buildConstraintsSection(opts))

  let compiled = sections.filter(Boolean).join('\n')

  if (compiled.length > maxChars) {
    compiled = truncateToFit(compiled, maxChars)
  }

  return compiled
}

function buildHeaderSection(step: Step, stepId: string): string {
  return [
    `# ThreadOS Step Execution: ${step.name}`,
    '',
    '## Identity',
    `You are executing step \`${stepId}\` ("${step.name}") in a ThreadOS sequence.`,
    `Thread type: ${step.type} | Model: ${step.model}`,
    '',
  ].join('\n')
}

function buildThreadTypeSection(step: Step, sequence: Sequence): string {
  const typeContext = buildThreadTypeContext(step, sequence)
  return typeContext ? `${typeContext}\n` : ''
}

function buildTaskSection(rawPrompt: string): string {
  return ['## Your Task', '', rawPrompt.trim(), ''].join('\n')
}

function buildSequenceStateSection(stepId: string, sequence: Sequence): string {
  return ['## Sequence State', '', buildSequenceState(stepId, sequence), ''].join('\n')
}

async function buildArtifactsSection(step: Step, sequence: Sequence, basePath: string, maxChars: number): string {
  const artifacts = await loadDependencyArtifacts(step, sequence, basePath)
  if (artifacts.length === 0) return ''

  const artifactBudget = Math.floor(maxChars * 0.3)
  return ['## Prior Step Outputs', '', formatArtifacts(artifacts, artifactBudget), ''].join('\n')
}

function buildWorkingDirSection(step: Step, basePath: string): string {
  const cwd = step.cwd || basePath
  return ['## Working Directory', '', `\`${cwd}\``, ''].join('\n')
}

async function buildFileTreeSection(basePath: string): string {
  const fileTree = await buildFileTree(basePath)
  if (!fileTree) return ''
  return ['## Project Files', '', fileTree, ''].join('\n')
}

function buildConstraintsSection(opts: CompileOptions): string {
  const lines = ['## Constraints', '']

  if (opts.step.timeout_ms) {
    lines.push(`- Timeout: ${Math.round(opts.step.timeout_ms / 1000)}s`)
  }

  lines.push('- Exit 0 on success, non-zero on failure')
  lines.push('- Exit 42 if you need human review before continuing')
  lines.push('- If you create files, list them as: FILES_CREATED: path1, path2, ...')

  if (opts.runtimeEventLogPath) {
    lines.push(`- If you delegate work or merge work into another thread, append one JSON object per line to THREADOS_EVENT_LOG (${opts.runtimeEventLogPath})`)
    lines.push('- Runtime event types: `spawn-child` with childStepId/childLabel/spawnKind, and `merge-into` with destinationStepId/sourceStepIds/mergeKind')
    if (opts.runtimeEventEmitterCommand) {
      lines.push(`- Prefer the emitter command exposed in THREADOS_EVENT_EMITTER. Use \`${opts.runtimeEventEmitterCommand} spawn-child <child-step-id> --label <child label> --kind <orchestrator|watchdog|fanout>\` for child delegation.`)
      lines.push(`- Use \`${opts.runtimeEventEmitterCommand} merge-into <destination-step-id> --sources <source-a,source-b> --kind <single|block>\` for merges.`)
    }
  }

  lines.push('')
  return lines.join('\n')
}

/**
 * Build thread-type-specific context framing
 */

interface ThreadTypeRule {
  match: (step: Step, allSteps: Step[]) => boolean
  build: (step: Step, allSteps: Step[]) => string
}

const THREAD_TYPE_RULES: Record<string, ThreadTypeRule> = {
  c: {
    match: () => true,
    build: (step, allSteps) => {
      const chainSteps = allSteps.filter(s => s.type === 'c')
      const position = chainSteps.findIndex(s => s.id === step.id) + 1
      return `**Chained workflow** \u2014 This is phase ${position} of ${chainSteps.length}. Complete your phase fully before the next phase begins.`
    },
  },
  p: {
    match: () => true,
    build: (step, allSteps) => {
      if (!step.group_id) {
        return `**Parallel execution** \u2014 You are one of multiple parallel workers. Work independently. Do not coordinate with other workers.`
      }
      const groupSteps = allSteps.filter(s => s.group_id === step.group_id)
      const workerN = groupSteps.findIndex(s => s.id === step.id) + 1
      return `**Parallel execution** \u2014 You are worker ${workerN} of ${groupSteps.length} in group \`${step.group_id}\`. Work independently. Do not coordinate with other workers.`
    },
  },
  f: {
    match: (step) => Boolean(step.fusion_synth || step.fusion_candidates),
    build: (step, allSteps) => {
      if (step.fusion_synth) {
        const candidates = allSteps.filter(s => s.fusion_candidates)
        return `**Fusion synthesis** \u2014 You are the synthesis step. ${candidates.length} candidates have produced independent solutions. Review all candidate outputs below and synthesize the best parts into a single unified solution.`
      }
      const candidates = allSteps.filter(s => s.fusion_candidates)
      return `**Fusion candidate** \u2014 You are one of ${candidates.length} candidates. Produce your best independent solution. A synthesis step will later merge the best parts from all candidates.`
    },
  },
  b: {
    match: () => true,
    build: (step) => {
      if (step.depends_on.length > 0) {
        return `**Baton hand-off** \u2014 The previous agent(s) (${step.depends_on.join(', ')}) have completed their work. Continue from where they left off. Their output is in "Prior Step Outputs" below.`
      }
      return `**Baton initiator** \u2014 You are starting a baton workflow. Subsequent agents will continue from your output.`
    },
  },
  l: {
    match: () => true,
    build: (step) => `**Long autonomy** \u2014 You have extended autonomous operation time. Work independently toward the goal. If you need to save progress, write checkpoints to \`.threados/state/${step.id}.json\`.`,
  },
}

function buildThreadTypeContext(step: Step, sequence: Sequence): string | null {
  const rule = THREAD_TYPE_RULES[step.type]
  if (!rule) return null
  if (!rule.match(step, sequence.steps)) return null
  return rule.build(step, sequence.steps)
}

/**
 * Build compact sequence state summary
 */
function buildSequenceState(currentStepId: string, sequence: Sequence): string {
  const lines: string[] = []

  const statusGroups: Array<{ filter: (s: Step) => boolean; label: string; format?: (s: Step) => string }> = [
    { filter: s => s.status === 'DONE', label: 'Completed' },
    { filter: s => s.status === 'RUNNING', label: 'Running', format: s => `${s.id}${s.id === currentStepId ? ' \u2190 you' : ''}` },
    { filter: s => s.status === 'READY' && s.id !== currentStepId, label: 'Pending' },
    { filter: s => s.status === 'FAILED', label: 'Failed' },
  ]

  for (const { filter, label, format } of statusGroups) {
    const matching = sequence.steps.filter(filter)
    if (matching.length > 0) {
      const formatter = format ?? ((s: Step) => s.id)
      lines.push(`${label}: ${matching.map(formatter).join(', ')}`)
    }
  }

  const gates = sequence.gates
  if (gates.length > 0) {
    const gateLines = gates.map(g => `${g.id} (${g.status})`)
    lines.push(`Gates: ${gateLines.join(', ')}`)
  }

  return lines.length > 0 ? lines.join('\n') : 'No other steps in sequence.'
}

/**
 * Load stdout artifacts from direct dependency steps
 */
async function loadDependencyArtifacts(
  step: Step,
  sequence: Sequence,
  basePath: string
): Promise<DependencyArtifact[]> {
  const artifacts: DependencyArtifact[] = []
  const runsDir = join(basePath, '.threados', 'runs')

  for (const depId of step.depends_on) {
    // Skip gate dependencies
    if (sequence.gates.some(g => g.id === depId)) continue

    const depStep = sequence.steps.find(s => s.id === depId)
    if (!depStep || depStep.status !== 'DONE') continue

    const artifact = await loadSingleArtifact(runsDir, depId)
    if (artifact) artifacts.push(artifact)
  }

  return artifacts
}

async function loadSingleArtifact(runsDir: string, depId: string): Promise<DependencyArtifact | null> {
  try {
    const runDirNames = await readdir(runsDir).catch(() => [] as string[])
    const runDirsWithTime = await collectRunDirsWithTime(runsDir, runDirNames, depId)
    runDirsWithTime.sort((a, b) => b.mtime - a.mtime)

    for (const { name: runId } of runDirsWithTime) {
      const result = await readArtifactFromRun(runsDir, runId, depId)
      if (result) return result
    }
  } catch { /* no artifacts for this dep */ }
  return null
}

async function collectRunDirsWithTime(runsDir: string, runDirNames: string[], depId: string) {
  const results: { name: string; mtime: number }[] = []
  for (const name of runDirNames) {
    const stepArtifactDir = join(runsDir, name, depId)
    try {
      const s = await stat(stepArtifactDir)
      results.push({ name, mtime: s.mtimeMs })
    } catch { /* no artifacts for this dep in this run */ }
  }
  return results
}

async function readArtifactFromRun(runsDir: string, runId: string, depId: string): Promise<DependencyArtifact | null> {
  const stdoutPath = join(runsDir, runId, depId, 'stdout.log')
  const statusPath = join(runsDir, runId, depId, 'status.json')
  try {
    const stdout = await readFile(stdoutPath, 'utf-8')
    if (!stdout.trim()) return null

    let duration: number | undefined
    try {
      const statusJson = JSON.parse(await readFile(statusPath, 'utf-8'))
      duration = statusJson.duration
    } catch { /* no status file */ }

    return { stepId: depId, stdout, duration }
  } catch {
    return null
  }
}

/**
 * Format dependency artifacts within a character budget
 */
function formatArtifacts(artifacts: DependencyArtifact[], budgetChars: number): string {
  if (artifacts.length === 0) return ''

  const perArtifact = Math.floor(budgetChars / artifacts.length)
  const lines: string[] = []

  for (const art of artifacts) {
    const durationStr = art.duration ? ` (${Math.round(art.duration / 1000)}s)` : ''
    lines.push(`--- Output from step "${art.stepId}"${durationStr} ---`)

    let content = art.stdout.trim()
    if (content.length > perArtifact) {
      content = content.slice(-perArtifact) // keep the tail (most recent output)
      lines.push('[...truncated...]')
    }
    lines.push(content)
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Build top-level project file tree
 */
async function buildFileTree(basePath: string): Promise<string | null> {
  try {
    const entries = await readdir(basePath, { withFileTypes: true })
    const relevant = entries
      .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
      .sort((a, b) => {
        // Directories first
        if (a.isDirectory() && !b.isDirectory()) return -1
        if (!a.isDirectory() && b.isDirectory()) return 1
        return a.name.localeCompare(b.name)
      })
      .slice(0, 30) // cap at 30 entries
      .map(e => `${e.isDirectory() ? '\ud83d\udcc1' : '\ud83d\udcc4'} ${e.name}`)

    return relevant.length > 0 ? relevant.join('\n') : null
  } catch {
    return null
  }
}

/**
 * Truncate compiled prompt to fit budget, preserving head (task) and tail (constraints)
 */
function truncateToFit(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text

  const separator = '\n\n[...context truncated to fit token budget...]\n\n'
  const available = maxChars - separator.length
  if (available <= 0) return text.slice(0, maxChars)

  const headSize = Math.floor(available * 0.65)
  const tailSize = available - headSize
  const head = text.slice(0, headSize)
  const tail = text.slice(-tailSize)

  return `${head}${separator}${tail}`
}

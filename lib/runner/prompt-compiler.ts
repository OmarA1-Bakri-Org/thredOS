import { readFile, readdir, stat } from 'fs/promises'
import { join, relative } from 'path'
import type { Step, Sequence } from '../sequence/schema'

export interface CompileOptions {
  stepId: string
  step: Step
  rawPrompt: string
  sequence: Sequence
  basePath: string
  maxTokens?: number
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

  // Header
  sections.push(`# ThreadOS Step Execution: ${step.name}`)
  sections.push('')

  // Identity
  sections.push('## Identity')
  sections.push(`You are executing step \`${stepId}\` ("${step.name}") in a ThreadOS sequence.`)
  sections.push(`Thread type: ${step.type} | Model: ${step.model}`)
  sections.push('')

  // Thread-type-specific framing
  const typeContext = buildThreadTypeContext(step, sequence)
  if (typeContext) {
    sections.push(typeContext)
    sections.push('')
  }

  // The actual task
  sections.push('## Your Task')
  sections.push('')
  sections.push(rawPrompt.trim())
  sections.push('')

  // Sequence state (compact)
  sections.push('## Sequence State')
  sections.push('')
  sections.push(buildSequenceState(stepId, sequence))
  sections.push('')

  // Dependency artifacts (truncated to budget)
  const artifacts = await loadDependencyArtifacts(step, sequence, basePath)
  if (artifacts.length > 0) {
    sections.push('## Prior Step Outputs')
    sections.push('')
    const artifactBudget = Math.floor(maxChars * 0.3) // 30% of budget for artifacts
    sections.push(formatArtifacts(artifacts, artifactBudget))
    sections.push('')
  }

  // Working directory
  const cwd = step.cwd || basePath
  sections.push('## Working Directory')
  sections.push('')
  sections.push(`\`${cwd}\``)
  sections.push('')

  // Project file tree (top level only)
  const fileTree = await buildFileTree(basePath)
  if (fileTree) {
    sections.push('## Project Files')
    sections.push('')
    sections.push(fileTree)
    sections.push('')
  }

  // Constraints
  sections.push('## Constraints')
  sections.push('')
  if (step.timeout_ms) {
    sections.push(`- Timeout: ${Math.round(step.timeout_ms / 1000)}s`)
  }
  sections.push('- Exit 0 on success, non-zero on failure')
  sections.push('- Exit 42 if you need human review before continuing')
  sections.push('- If you create files, list them as: FILES_CREATED: path1, path2, ...')
  sections.push('')

  let compiled = sections.join('\n')

  // Enforce token budget by truncating from the middle (preserve task + constraints)
  if (compiled.length > maxChars) {
    compiled = truncateToFit(compiled, maxChars)
  }

  return compiled
}

/**
 * Build thread-type-specific context framing
 */
function buildThreadTypeContext(step: Step, sequence: Sequence): string | null {
  const allSteps = sequence.steps

  switch (step.type) {
    case 'c': {
      // Chained: show phase position
      const chainSteps = allSteps.filter(s => s.type === 'c')
      const position = chainSteps.findIndex(s => s.id === step.id) + 1
      return `**Chained workflow** \u2014 This is phase ${position} of ${chainSteps.length}. Complete your phase fully before the next phase begins.`
    }

    case 'p': {
      // Parallel: show group context (guard against missing group_id)
      if (!step.group_id) {
        return `**Parallel execution** \u2014 You are one of multiple parallel workers. Work independently. Do not coordinate with other workers.`
      }
      const groupSteps = allSteps.filter(s => s.group_id === step.group_id)
      const workerN = groupSteps.findIndex(s => s.id === step.id) + 1
      return `**Parallel execution** \u2014 You are worker ${workerN} of ${groupSteps.length} in group \`${step.group_id}\`. Work independently. Do not coordinate with other workers.`
    }

    case 'f': {
      if (step.fusion_synth) {
        const candidates = allSteps.filter(s => s.fusion_candidates)
        return `**Fusion synthesis** \u2014 You are the synthesis step. ${candidates.length} candidates have produced independent solutions. Review all candidate outputs below and synthesize the best parts into a single unified solution.`
      }
      if (step.fusion_candidates) {
        const candidates = allSteps.filter(s => s.fusion_candidates)
        return `**Fusion candidate** \u2014 You are one of ${candidates.length} candidates. Produce your best independent solution. A synthesis step will later merge the best parts from all candidates.`
      }
      return null
    }

    case 'b': {
      const prevSteps = step.depends_on
      if (prevSteps.length > 0) {
        return `**Baton hand-off** \u2014 The previous agent(s) (${prevSteps.join(', ')}) have completed their work. Continue from where they left off. Their output is in "Prior Step Outputs" below.`
      }
      return `**Baton initiator** \u2014 You are starting a baton workflow. Subsequent agents will continue from your output.`
    }

    case 'l': {
      return `**Long autonomy** \u2014 You have extended autonomous operation time. Work independently toward the goal. If you need to save progress, write checkpoints to \`.threados/state/${step.id}.json\`.`
    }

    default:
      return null
  }
}

/**
 * Build compact sequence state summary
 */
function buildSequenceState(currentStepId: string, sequence: Sequence): string {
  const lines: string[] = []

  const done = sequence.steps.filter(s => s.status === 'DONE')
  const running = sequence.steps.filter(s => s.status === 'RUNNING')
  const ready = sequence.steps.filter(s => s.status === 'READY' && s.id !== currentStepId)
  const failed = sequence.steps.filter(s => s.status === 'FAILED')

  if (done.length > 0) {
    lines.push(`Completed: ${done.map(s => s.id).join(', ')}`)
  }
  if (running.length > 0) {
    lines.push(`Running: ${running.map(s => `${s.id}${s.id === currentStepId ? ' \u2190 you' : ''}`).join(', ')}`)
  }
  if (ready.length > 0) {
    lines.push(`Pending: ${ready.map(s => s.id).join(', ')}`)
  }
  if (failed.length > 0) {
    lines.push(`Failed: ${failed.map(s => s.id).join(', ')}`)
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

    try {
      // Find the most recent run for this step (sort by mtime, newest first)
      const runDirNames = await readdir(runsDir).catch(() => [] as string[])
      const runDirsWithTime: { name: string; mtime: number }[] = []
      for (const name of runDirNames) {
        const stepArtifactDir = join(runsDir, name, depId)
        try {
          const s = await stat(stepArtifactDir)
          runDirsWithTime.push({ name, mtime: s.mtimeMs })
        } catch { /* no artifacts for this dep in this run */ }
      }
      runDirsWithTime.sort((a, b) => b.mtime - a.mtime) // newest first

      let latestStdout = ''
      let latestDuration: number | undefined
      for (const { name: runId } of runDirsWithTime) {
        const stdoutPath = join(runsDir, runId, depId, 'stdout.log')
        const statusPath = join(runsDir, runId, depId, 'status.json')
        try {
          latestStdout = await readFile(stdoutPath, 'utf-8')
          try {
            const statusJson = JSON.parse(await readFile(statusPath, 'utf-8'))
            latestDuration = statusJson.duration
          } catch { /* no status file */ }
          break // found the latest
        } catch { continue }
      }

      if (latestStdout.trim()) {
        artifacts.push({ stepId: depId, stdout: latestStdout, duration: latestDuration })
      }
    } catch { /* no artifacts for this dep */ }
  }

  return artifacts
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

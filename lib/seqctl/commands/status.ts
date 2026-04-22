import { readSequence } from '../../sequence/parser'
import { readMprocsMap, type MprocsMap } from '../../mprocs/state'
import type { Sequence, Step, Gate } from '../../sequence/schema'

interface CLIOptions {
  json: boolean
  help: boolean
  watch: boolean
  basePath?: string
}

interface StepStatusInfo {
  id: string
  name: string
  type: string
  status: string
  model: string
  dependsOn: string[]
  processIndex?: number
}

interface GateStatusInfo {
  id: string
  name: string
  status: string
  dependsOn: string[]
}

interface SequenceStatus {
  name: string
  version: string
  steps: StepStatusInfo[]
  gates: GateStatusInfo[]
  summary: {
    total: number
    ready: number
    running: number
    done: number
    skipped: number
    failed: number
    blocked: number
    needsReview: number
  }
}

/**
 * Build status info for a step
 */
function buildStepStatus(step: Step, mprocsMap: MprocsMap): StepStatusInfo {
  return {
    id: step.id,
    name: step.name,
    type: step.type,
    status: step.status,
    model: step.model,
    dependsOn: step.depends_on,
    processIndex: mprocsMap[step.id],
  }
}

/**
 * Build status info for a gate
 */
function buildGateStatus(gate: Gate): GateStatusInfo {
  return {
    id: gate.id,
    name: gate.name,
    status: gate.status,
    dependsOn: gate.depends_on,
  }
}

/**
 * Build summary statistics
 */
function buildSummary(sequence: Sequence) {
  const summary = {
    total: sequence.steps.length,
    ready: 0,
    running: 0,
    done: 0,
    skipped: 0,
    failed: 0,
    blocked: 0,
    needsReview: 0,
  }

  for (const step of sequence.steps) {
    switch (step.status) {
      case 'READY':
        summary.ready++
        break
      case 'RUNNING':
        summary.running++
        break
      case 'DONE':
        summary.done++
        break
      case 'SKIPPED':
        summary.skipped++
        break
      case 'FAILED':
        summary.failed++
        break
      case 'BLOCKED':
        summary.blocked++
        break
      case 'NEEDS_REVIEW':
        summary.needsReview++
        break
    }
  }

  return summary
}

/**
 * Display status in human-readable format
 */
function displayStatus(status: SequenceStatus): void {
  console.log(`\nSequence: ${status.name || '(unnamed)'} v${status.version}`)
  console.log('='.repeat(50))

  console.log('\nSteps:')
  if (status.steps.length === 0) {
    console.log('  (no steps)')
  } else {
    for (const step of status.steps) {
      const processInfo = step.processIndex !== undefined
        ? ` [proc:${step.processIndex}]`
        : ''
      const deps = step.dependsOn.length > 0
        ? ` (deps: ${step.dependsOn.join(', ')})`
        : ''
      console.log(`  ${step.id}: ${step.status}${processInfo}${deps}`)
      console.log(`    ${step.name} (${step.type}/${step.model})`)
    }
  }

  if (status.gates.length > 0) {
    console.log('\nGates:')
    for (const gate of status.gates) {
      const deps = gate.dependsOn.length > 0
        ? ` (deps: ${gate.dependsOn.join(', ')})`
        : ''
      console.log(`  ${gate.id}: ${gate.status}${deps}`)
      console.log(`    ${gate.name}`)
    }
  }

  console.log('\nSummary:')
  console.log(`  Total: ${status.summary.total}`)
  console.log(`  Ready: ${status.summary.ready}`)
  console.log(`  Running: ${status.summary.running}`)
  console.log(`  Done: ${status.summary.done}`)
  console.log(`  Skipped: ${status.summary.skipped}`)
  console.log(`  Failed: ${status.summary.failed}`)
  console.log(`  Blocked: ${status.summary.blocked}`)
  console.log(`  Needs Review: ${status.summary.needsReview}`)
  console.log()
}

/**
 * Status command handler
 */
export async function statusCommand(
  _subcommand: string | undefined,
  _args: string[],
  options: CLIOptions
): Promise<void> {
  const basePath = options.basePath ?? process.cwd()

  // Read sequence and mprocs map
  const sequence = await readSequence(basePath)
  const mprocsMap = await readMprocsMap(basePath)

  // Build status
  const status: SequenceStatus = {
    name: sequence.name,
    version: sequence.version,
    steps: sequence.steps.map(s => buildStepStatus(s, mprocsMap)),
    gates: sequence.gates.map(g => buildGateStatus(g)),
    summary: buildSummary(sequence),
  }

  if (options.watch) {
    // Watch mode: poll every 1 second
    const displayAndWait = async () => {
      while (true) {
        // Clear console
        console.clear()

        // Re-read and display
        const seq = await readSequence(basePath)
        const map = await readMprocsMap(basePath)

        const currentStatus: SequenceStatus = {
          name: seq.name,
          version: seq.version,
          steps: seq.steps.map(s => buildStepStatus(s, map)),
          gates: seq.gates.map(g => buildGateStatus(g)),
          summary: buildSummary(seq),
        }

        if (options.json) {
          console.log(JSON.stringify(currentStatus, null, 2))
        } else {
          displayStatus(currentStatus)
          console.log('Watching for changes... (Ctrl+C to exit)')
        }

        await Bun.sleep(1000)
      }
    }

    await displayAndWait()
  } else {
    // Single display
    if (options.json) {
      console.log(JSON.stringify(status, null, 2))
    } else {
      displayStatus(status)
    }
  }
}

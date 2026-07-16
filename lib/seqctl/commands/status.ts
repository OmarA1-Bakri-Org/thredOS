import type { SequenceStatusProjection } from '../../runtime/service-types'
import { renderRuntimeFailure, renderRuntimeSuccess, type CLIOptions } from '../formatters/runtime'
import { getCLIRuntimeService } from '../runtime'

interface CLIWatchRuntime {
  sleep(milliseconds: number): Promise<void>
  shouldContinue(): boolean
}

declare global {
  var __THREADOS_CLI_WATCH_RUNTIME__: CLIWatchRuntime | undefined
}

function watchRuntime(): CLIWatchRuntime {
  return globalThis.__THREADOS_CLI_WATCH_RUNTIME__ ?? {
    sleep: milliseconds => Bun.sleep(milliseconds),
    shouldContinue: () => true,
  }
}

function displayStatus(status: SequenceStatusProjection): void {
  console.log(`\nSequence: ${status.name || '(unnamed)'} v${status.version}`)
  console.log('='.repeat(50))
  console.log('\nSteps:')
  if (status.steps.length === 0) {
    console.log('  (no steps)')
  } else {
    for (const step of status.steps) {
      const processInfo = step.processId ? ` [process:${step.processId}]` : ''
      const deps = step.dependsOn.length > 0 ? ` (deps: ${step.dependsOn.join(', ')})` : ''
      console.log(`  ${step.id}: ${step.status}${processInfo}${deps}`)
      console.log(`    ${step.name} (${step.type}/${step.model})`)
    }
  }
  if (status.gates.length > 0) {
    console.log('\nGates:')
    for (const gate of status.gates) {
      const deps = gate.dependsOn.length > 0 ? ` (deps: ${gate.dependsOn.join(', ')})` : ''
      console.log(`  ${gate.id}: ${gate.status}${deps}`)
      console.log(`    ${gate.name}`)
    }
  }
  console.log('\nSummary:')
  console.log(`  Total: ${status.summary.total}`)
  console.log(`  Ready: ${status.summary.ready}`)
  console.log(`  Running: ${status.summary.running}`)
  console.log(`  Done: ${status.summary.done}`)
  console.log(`  Failed: ${status.summary.failed}`)
  console.log(`  Blocked: ${status.summary.blocked}`)
  console.log(`  Needs Review: ${status.summary.needsReview}`)
  console.log()
}

function display(status: SequenceStatusProjection, options: CLIOptions): void {
  renderRuntimeSuccess(status, options, () => displayStatus(status))
}

export async function statusCommand(
  _subcommand: string | undefined,
  _args: string[],
  options: CLIOptions,
): Promise<void> {
  try {
    const service = await getCLIRuntimeService(options.basePath ?? process.cwd())
    if (!options.watch) {
      display(await service.getStatus(), options)
      return
    }

    const watcher = watchRuntime()
    while (watcher.shouldContinue()) {
      if (!options.json) console.clear()
      display(await service.getStatus(), options)
      if (!options.json) console.log('Watching for changes... (Ctrl+C to exit)')
      await watcher.sleep(1000)
    }
  } catch (error) {
    renderRuntimeFailure(error, options)
  }
}

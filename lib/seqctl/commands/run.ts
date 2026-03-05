import { randomUUID } from 'crypto'
import { readSequence, writeSequence } from '../../sequence/parser'
import { validateDAG, topologicalSort } from '../../sequence/dag'
import { MprocsClient } from '../../mprocs/client'
import { updateStepProcess, readMprocsMap } from '../../mprocs/state'
import { runStep } from '../../runner/wrapper'
import { saveRunArtifacts } from '../../runner/artifacts'
import { compilePrompt } from '../../runner/prompt-compiler'
import { dispatch, exitCodeToStatus } from '../../runner/dispatch'
import { readPrompt, validatePromptExists } from '../../prompts/manager'
import { StepNotFoundError, PromptNotFoundError } from '../../errors'
import type { Step, Sequence, StepStatus } from '../../sequence/schema'

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

interface CLIOptions {
  json: boolean
  help: boolean
  watch: boolean
}

interface RunStepResult {
  success: boolean
  stepId: string
  runId: string
  status: StepStatus
  duration?: number
  exitCode?: number | null
  artifactPath?: string
  error?: string
}

interface RunRunnableResult {
  success: boolean
  executed: RunStepResult[]
  skipped: string[]
  error?: string
}

/**
 * Get runnable steps (READY status with all dependencies satisfied)
 */
function getRunnableSteps(sequence: Sequence): Step[] {
  const doneSteps = new Set(
    sequence.steps
      .filter(s => s.status === 'DONE')
      .map(s => s.id)
  )

  // Gates that are approved also count as done
  const approvedGates = new Set(
    sequence.gates
      .filter(g => g.status === 'APPROVED')
      .map(g => g.id)
  )

  const completedNodes = new Set([...doneSteps, ...approvedGates])

  return sequence.steps.filter(step => {
    if (step.status !== 'READY') return false

    // Check all dependencies are satisfied
    return step.depends_on.every(depId => completedNodes.has(depId))
  })
}

/**
 * Execute a single step via the Agent Execution Protocol:
 * 1. Read prompt file
 * 2. Compile with context (sequence state, dependency artifacts, project info)
 *    - Shell steps skip compilation and pass raw script directly
 * 3. Dispatch to agent CLI (claude, codex, gemini, sh)
 * 4. Run via existing runner (spawn, capture, timeout)
 * 5. Map exit code to status
 */
async function executeSingleStep(
  basePath: string,
  sequence: Sequence,
  stepId: string,
  runId: string,
  _client: MprocsClient
): Promise<RunStepResult> {
  const step = sequence.steps.find(s => s.id === stepId)
  if (!step) {
    throw new StepNotFoundError(stepId)
  }

  // Validate prompt file exists \u2014 use step.prompt_file, not hardcoded stepId path
  const promptPath = step.prompt_file
  const promptExists = await validatePromptExists(basePath, stepId)
  if (!promptExists) {
    // Bug fix: persist FAILED status so step isn't re-selected by run runnable
    step.status = 'FAILED'
    await writeSequence(basePath, sequence)
    return {
      success: false,
      stepId,
      runId,
      status: 'FAILED',
      error: `Prompt file not found for step '${stepId}'. Expected: ${promptPath}`,
    }
  }

  // Update status to RUNNING
  step.status = 'RUNNING'
  await writeSequence(basePath, sequence)

  try {
    // 1. Read raw prompt
    const rawPrompt = await readPrompt(basePath, stepId)

    // 2. Compile with context (skip for shell \u2014 shell runs raw script directly)
    const promptForDispatch = step.model === 'shell'
      ? rawPrompt
      : await compilePrompt({
          stepId,
          step,
          rawPrompt,
          sequence,
          basePath,
          maxTokens: step.model === 'claude-code' ? 8000 : 4000,
        })

    // 3. Dispatch to agent (writes temp prompt, resolves CLI, checks availability)
    const runnerConfig = await dispatch(step.model, {
      stepId,
      runId,
      compiledPrompt: promptForDispatch,
      cwd: step.cwd || basePath,
      timeout: step.timeout_ms || DEFAULT_TIMEOUT_MS,
    })

    // 4. Execute via runner
    const result = await runStep(runnerConfig)

    // 5. Save artifacts
    const artifactPath = await saveRunArtifacts(basePath, result)

    // 6. Map exit code to step status
    const newStatus = exitCodeToStatus(result.exitCode)
    step.status = newStatus
    await writeSequence(basePath, sequence)

    return {
      success: newStatus === 'DONE',
      stepId,
      runId,
      status: step.status,
      duration: result.duration,
      exitCode: result.exitCode,
      artifactPath,
    }
  } catch (error) {
    step.status = 'FAILED'
    try {
      await writeSequence(basePath, sequence)
    } catch (writeError) {
      console.error(
        `Failed to persist failed step '${stepId}' for run '${runId}':`,
        writeError
      )
    }

    return {
      success: false,
      stepId,
      runId,
      status: 'FAILED',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Run command handler
 */
export async function runCommand(
  subcommand: string | undefined,
  args: string[],
  options: CLIOptions
): Promise<void> {
  const basePath = process.cwd()
  const runId = randomUUID()

  // Read and validate sequence
  const sequence = await readSequence(basePath)
  validateDAG(sequence)

  const mprocsClient = new MprocsClient()

  if (subcommand === 'step') {
    // Run a specific step
    const stepId = args[0]
    if (!stepId) {
      const errorMsg = 'Step ID required: seqctl run step <stepId>'
      if (options.json) {
        console.log(JSON.stringify({ error: errorMsg, success: false }))
      } else {
        console.error(errorMsg)
      }
      process.exit(1)
    }

    const result = await executeSingleStep(
      basePath,
      sequence,
      stepId,
      runId,
      mprocsClient
    )

    // Update mprocs map
    const mprocsMap = await readMprocsMap(basePath)
    const processIndex = Object.keys(mprocsMap).length
    await updateStepProcess(basePath, stepId, processIndex)

    if (options.json) {
      console.log(JSON.stringify(result))
    } else {
      if (result.success) {
        console.log(`Step '${stepId}' completed successfully`)
        console.log(`Duration: ${result.duration}ms`)
        console.log(`Artifacts: ${result.artifactPath}`)
      } else {
        console.error(`Step '${stepId}' failed: ${result.error || 'Unknown error'}`)
      }
    }
  } else if (subcommand === 'runnable') {
    // Run all runnable steps
    const runnableSteps = getRunnableSteps(sequence)

    if (runnableSteps.length === 0) {
      const result: RunRunnableResult = {
        success: true,
        executed: [],
        skipped: [],
        error: 'No runnable steps found',
      }
      if (options.json) {
        console.log(JSON.stringify(result))
      } else {
        console.log('No runnable steps found')
      }
      return
    }

    // Get topological order and filter to runnable
    const order = topologicalSort(sequence)
    const orderedRunnable = order.filter(id =>
      runnableSteps.some(s => s.id === id)
    )

    const executed: RunStepResult[] = []
    const skipped: string[] = []

    for (const stepId of orderedRunnable) {
      const result = await executeSingleStep(
        basePath,
        sequence,
        stepId,
        runId,
        mprocsClient
      )
      executed.push(result)

      // If a step fails, we might want to skip dependent steps
      if (!result.success) {
        // Find steps that depend on this one and mark them as skipped
        const dependentSteps = sequence.steps.filter(s =>
          s.depends_on.includes(stepId) && orderedRunnable.includes(s.id)
        )
        for (const dep of dependentSteps) {
          if (!executed.some(e => e.stepId === dep.id)) {
            skipped.push(dep.id)
          }
        }
      }
    }

    const result: RunRunnableResult = {
      success: executed.every(e => e.success),
      executed,
      skipped,
    }

    if (options.json) {
      console.log(JSON.stringify(result))
    } else {
      console.log(`Executed ${executed.length} step(s)`)
      for (const e of executed) {
        const status = e.success ? 'DONE' : 'FAILED'
        console.log(`  ${e.stepId}: ${status} (${e.duration}ms)`)
      }
      if (skipped.length > 0) {
        console.log(`Skipped ${skipped.length} step(s) due to failures:`)
        for (const s of skipped) {
          console.log(`  ${s}`)
        }
      }
    }
  } else if (subcommand === 'group') {
    // Run all READY steps in a group
    const groupId = args[0]
    if (!groupId) {
      const errorMsg = 'Group ID required: seqctl run group <groupId>'
      if (options.json) {
        console.log(JSON.stringify({ error: errorMsg, success: false }))
      } else {
        console.error(errorMsg)
      }
      process.exit(1)
    }

    const groupSteps = sequence.steps.filter(s => s.group_id === groupId)
    if (groupSteps.length === 0) {
      const errorMsg = `No steps found in group '${groupId}'`
      if (options.json) {
        console.log(JSON.stringify({ error: errorMsg, success: false }))
      } else {
        console.error(errorMsg)
      }
      process.exit(1)
    }

    const runnableInGroup = groupSteps.filter(s => {
      if (s.status !== 'READY') return false
      const doneSteps = new Set(sequence.steps.filter(st => st.status === 'DONE').map(st => st.id))
      const approvedGates = new Set(sequence.gates.filter(g => g.status === 'APPROVED').map(g => g.id))
      const completed = new Set([...doneSteps, ...approvedGates])
      return s.depends_on.every(dep => completed.has(dep))
    })

    const executed: RunStepResult[] = []
    // Run all in parallel
    const promises = runnableInGroup.map(s =>
      executeSingleStep(basePath, sequence, s.id, runId, mprocsClient)
    )
    const results = await Promise.all(promises)
    executed.push(...results)

    const result: RunRunnableResult = {
      success: executed.every(e => e.success),
      executed,
      skipped: [],
    }

    if (options.json) {
      console.log(JSON.stringify(result))
    } else {
      console.log(`Executed ${executed.length} step(s) from group '${groupId}'`)
      for (const e of executed) {
        const status = e.success ? 'DONE' : 'FAILED'
        console.log(`  ${e.stepId}: ${status} (${e.duration}ms)`)
      }
    }
  } else {
    const errorMsg = 'Unknown subcommand. Usage: seqctl run step|runnable|group'
    if (options.json) {
      console.log(JSON.stringify({ error: errorMsg, success: false }))
    } else {
      console.error(errorMsg)
    }
    process.exit(1)
  }
}

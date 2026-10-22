import { createFixtureRoot, removeFixtureTree } from '../helpers/remove-fixture-tree'
import { buildAgentComposition } from '@/lib/agents/composition'
import { writeAgentState } from '@/lib/agents/repository'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { PolicyConfigSchema } from '@/lib/policy/schema'
import type { RawProcessResult, RunningProcessHandle } from '@/lib/runner/process-handle'
import type { Sequence, Step } from '@/lib/sequence/schema'
import { clearRuntimeServiceFactoryForTests, getThreadOSRuntimeService } from '@/lib/runtime/factory'
import { WorkspaceRepository } from '@/lib/workspaces/repository'
import { readLocalWorkspace } from '@/lib/local-first/workspace'
import type { CompletedRunResult, RuntimeServiceDependencies } from '@/lib/runtime/service-types'

export interface Pr11Fixture {
  root: string
  canonical: string
  runtime: string
  sequence: Sequence
  run(): Promise<CompletedRunResult>
  cleanup(): Promise<void>
}

function step(id: string): Step {
  return {
    id,
    name: id,
    type: 'base',
    model: 'shell',
    assigned_agent_id: `fixture-agent-${id}`, agent_ref: `fixture-agent-${id}`,
    prompt_file: `.threados/prompts/${id}.md`,
    prompt_ref: { id, version: 1, path: `.threados/prompts/${id}.md` },
    status: 'READY',
    depends_on: [],
    side_effect_class: 'write',
    workspace_mode: 'isolated',
  }
}

export async function createPr11Fixture(
  stepIds: string[],
  onProcessStart?: (canonical: string) => Promise<void>,
  useRealProcess = false,
): Promise<Pr11Fixture> {
  const root = await createFixtureRoot('threados-pr11-proof-')
  const canonical = join(root, 'canonical')
  const runtime = join(root, 'runtime-data')
  await mkdir(join(canonical, '.threados', 'prompts'), { recursive: true })
  await mkdir(runtime, { recursive: true })
  await writeFile(join(canonical, 'source.txt'), 'canonical-baseline\n')
  await writeFile(join(canonical, '.threados', 'workspace.yaml'), [
    'version: 1',
    'provider: copy',
    `runtime_data_root: ${JSON.stringify(runtime)}`,
    'snapshot:',
    '  exclusions: [.git/, .threados/, node_modules/]',
    '  include_untracked: true',
    '  max_source_retries: 3',
    'workspace:',
    '  retention: retain_until_applied',
    '  max_active: 5',
    '  max_bytes_each: 5368709120',
    '  max_total_retained_bytes: 21474836480',
    '  max_files: 250000',
    'bootstrap: []',
    'validate: []',
    '',
  ].join('\n'))
  for (const id of stepIds) {
    await writeFile(join(canonical, '.threados', 'prompts', `${id}.md`), `write ${id}\n`)
  }
  const sequence: Sequence = {
    version: '1',
    id: 'sequence-pr11',
    name: 'sequence-pr11',
    steps: stepIds.map(step),
    gates: [],
  }
  await writeAgentState(canonical, { version: 1, agents: sequence.steps.map(boundStep => ({
    id: boundStep.assigned_agent_id!, name: boundStep.id, builderId: 'integration-builder', builderName: 'Integration Builder',
    registeredAt: '2026-01-01T00:00:00.000Z', version: 1, threadSurfaceIds: [],
    composition: buildAgentComposition({ model: boundStep.model, role: boundStep.role, promptRef: boundStep.prompt_ref,
      skillRefs: boundStep.skill_refs }),
  })) })
  const dependencies: Partial<RuntimeServiceDependencies> = {
      loadSequence: async () => sequence,
      loadPolicy: async () => PolicyConfigSchema.parse({ mode: 'POWER', side_effect_mode: 'free' }),
      validateSequence: () => undefined,
      validatePrompt: async () => true,
      compilePrompt: async () => 'fixture prompt',
      allowModelExecution: () => ({ allowed: true }),
      dispatch: async (_model, options) => useRealProcess
        ? {
            stepId: options.stepId,
            runId: options.runId,
            command: process.execPath,
            args: ['-e', [
              "const fs=require('fs')",
              "fs.writeFileSync('agent-real.txt', 'real-process\\n')",
              'const runtimeContext={cwd:process.cwd(),workspaceId:process.env.THREADOS_WORKSPACE_ID,snapshotId:process.env.THREADOS_SNAPSHOT_ID,attemptId:process.env.THREADOS_ATTEMPT_ID,basePath:process.env.THREADOS_BASE_PATH}',
              "fs.writeFileSync('agent-runtime-context.json', JSON.stringify(runtimeContext))",
            ].join(';')],
            cwd: options.cwd,
            env: options.env,
            deniedEnvKeys: options.deniedEnvKeys,
            runtimeEventLogPath: options.runtimeEventLogPath,
          }
        : {
            stepId: options.stepId,
            runId: options.runId,
            command: 'fixture-agent',
            args: [],
            cwd: options.cwd,
            env: options.env,
            deniedEnvKeys: options.deniedEnvKeys,
          },
    }
  if (!useRealProcess) {
    dependencies.startProcess = async config => {
        await onProcessStart?.(canonical)
        await writeFile(join(config.cwd!, `agent-${config.stepId}.txt`), `${config.stepId}\n`)
        const now = new Date()
        const result: RawProcessResult = {
          stepId: config.stepId,
          runId: config.runId,
          exitCode: 0,
          signal: null,
          status: 'SUCCESS',
          duration: 1,
          stdout: 'ok',
          stderr: '',
          startTime: now,
          endTime: now,
        }
        return {
          processId: config.processId!,
          pid: 4242,
          result: Promise.resolve(result),
          cancel: async signal => ({ success: true, signal: signal ?? 'SIGTERM', escalated: false }),
        } satisfies RunningProcessHandle
      }
  }
  const service = await getThreadOSRuntimeService(canonical, {
    dependencies,
  })

  return {
    root,
    canonical,
    runtime,
    sequence,
    async run() {
      return await service.runAndWait({
        sequence_id: sequence.id!,
        target: stepIds.length === 1 ? { kind: 'step', step_id: stepIds[0]! } : { kind: 'runnable' },
        strategy: 'sequential',
        max_concurrency: 1,
      }, {
        actor: 'integration-test',
        interface: 'system',
        idempotencyKey: `pr11-${randomUUID()}`,
        policyConfirmed: true,
      })
    },
    async cleanup() {
      clearRuntimeServiceFactoryForTests()
      await removeFixtureTree(root)
    },
  }
}

export async function readCanonicalEvidence(
  canonical: string,
  runId: string,
  attemptId: string,
): Promise<{ classification: string; pre_hash: string; post_hash: string }> {
  return JSON.parse(await readFile(join(
    canonical,
    '.threados',
    'runs',
    runId,
    'attempts',
    attemptId,
    'canonical-precondition.json',
  ), 'utf8'))
}

export async function listFixtureWorkspaces(canonical: string) {
  return await new WorkspaceRepository(canonical).list()
}

export async function fixtureRuntimeRoot(canonical: string): Promise<string> {
  return (await readLocalWorkspace(canonical)).runtimeDataRoot
}

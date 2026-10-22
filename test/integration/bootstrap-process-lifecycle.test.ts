import { createFixtureRoot, removeFixtureTree } from '../helpers/remove-fixture-tree'
import { registerSequenceAgents } from '../helpers/registered-sequence'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { PolicyConfigSchema } from '@/lib/policy/schema'
import type { Sequence } from '@/lib/sequence/schema'
import {
  clearRuntimeServiceFactoryForTests,
  getThreadOSRuntimeService,
} from '@/lib/runtime/factory'
import { AttemptRepository } from '@/lib/runtime/attempt-repository'
import { ProcessRepository } from '@/lib/runtime/process-repository'
import { WorkspaceRepository } from '@/lib/workspaces/repository'
import { ProcessControlError } from '@/lib/runner/process-handle'
import { createPr11Fixture } from './pr11-workspace-test-helper'

const roots: string[] = []

afterEach(async () => {
  clearRuntimeServiceFactoryForTests()
  await Promise.all(roots.splice(0).map(path => removeFixtureTree(path)))
})

async function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await read()
    if (value !== null) return value
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('condition was not reached')
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

describe('workspace bootstrap process lifecycle', () => {
  test('keeps a live bootstrap under control after timeout control fails until verified cancellation', async () => {
    const fixture = await createPr11Fixture(['bootstrap-control'])
    let child: { pid: number; kill(signal: NodeJS.Signals): void; exited: Promise<number> } | undefined
    let completion: ReturnType<Awaited<ReturnType<typeof getThreadOSRuntimeService>>['runAndWait']> | undefined
    let settleForCleanup: (() => Promise<void>) | undefined
    try {
      const config = join(fixture.canonical, '.threados', 'workspace.yaml')
      await writeFile(config, (await readFile(config, 'utf8')).replace('bootstrap: []', 'bootstrap: [fixture-bootstrap prepare]'))
      clearRuntimeServiceFactoryForTests()
      let controls = 0
      let agentDispatches = 0
      const failedControl = {
        success: false as const, code: 'PROCESS_CONTROL_FAILED' as const,
        message: 'Timeout escalation could not stop the owned child', signal: 'SIGTERM' as const,
      }
      const service = await getThreadOSRuntimeService(fixture.canonical, { dependencies: {
        loadSequence: async () => fixture.sequence,
        loadPolicy: async () => PolicyConfigSchema.parse({ mode: 'POWER', side_effect_mode: 'free' }),
        compilePrompt: async () => 'fixture prompt',
        dispatch: async () => { agentDispatches += 1; throw new Error('agent must not dispatch') },
        startProcess: async runner => {
          child = Bun.spawn([process.execPath, '-e', 'setInterval(() => {}, 1000)'], {
            cwd: runner.cwd, stdout: 'ignore', stderr: 'ignore',
          })
          const result = Promise.reject(new ProcessControlError('Owned child remains live after timeout', failedControl))
          void result.catch(() => undefined)
          return {
            processId: runner.processId!, pid: child.pid, result,
            cancel: async () => {
              controls += 1
              if (controls === 1) return failedControl
              child!.kill('SIGKILL')
              await child!.exited
              return { success: true as const, signal: 'SIGKILL' as const, escalated: true }
            },
          }
        },
      } })
      settleForCleanup = async () => {
        for (let retry = 0; retry < 2; retry++) {
          const [record] = await new ProcessRepository(fixture.canonical).list()
          if (!record || record.status === 'exited') return
          await service.cancelAttempt(record.attempt_id, {
            actor: 'bootstrap-custody-test', interface: 'system', idempotencyKey: `cleanup-control-${retry}`, policyConfirmed: true,
          }).catch(() => undefined)
        }
      }
      completion = service.runAndWait({
        sequence_id: fixture.sequence.id!, target: { kind: 'step', step_id: 'bootstrap-control' },
        strategy: 'sequential', max_concurrency: 1,
      }, { actor: 'bootstrap-custody-test', interface: 'system', idempotencyKey: 'bootstrap-control-start', policyConfirmed: true })
      let settled = false
      void completion.then(() => { settled = true }, () => { settled = true })
      const processes = new ProcessRepository(fixture.canonical)
      const bootstrapRecord = await waitFor(async () => (await processes.list()).find(record => record.status === 'running') ?? null)
      const attempts = new AttemptRepository(fixture.canonical)
      // A public failed control is an observable barrier after the original
      // timeout failure; it must leave custody available for a stronger retry.
      await expect(service.cancelAttempt(bootstrapRecord.attempt_id, {
        actor: 'bootstrap-custody-test', interface: 'system', idempotencyKey: 'failed-control-retry', policyConfirmed: true,
      })).rejects.toMatchObject({ code: 'PROCESS_CONTROL_FAILED' })
      expect(settled).toBe(false)
      expect(await attempts.get(bootstrapRecord.attempt_id)).toMatchObject({ status: 'provisioning' })
      expect((await new WorkspaceRepository(fixture.canonical).list())[0]).toMatchObject({ status: 'active' })
      expect(processIsAlive(child!.pid)).toBe(true)
      const cancelled = await service.cancelAttempt(bootstrapRecord.attempt_id, {
        actor: 'bootstrap-custody-test', interface: 'system', idempotencyKey: 'verified-control-retry', policyConfirmed: true,
      })
      expect(cancelled.status).toBe('cancelled')
      expect(processIsAlive(child!.pid)).toBe(false)
      expect((await completion).run.status).toBe('cancelled')
      expect(await processes.get(bootstrapRecord.id)).toMatchObject({ status: 'exited', signal: 'SIGKILL' })
      expect(controls).toBe(2)
      expect(agentDispatches).toBe(0)
    } finally {
      if (child && processIsAlive(child.pid)) {
        child.kill('SIGKILL')
        await child.exited
      }
      await settleForCleanup?.()
      await completion?.catch(() => undefined)
      await fixture.cleanup()
    }
  }, 30_000)

  test('persists and cancels a long real bootstrap process before agent dispatch', async () => {
    const root = await createFixtureRoot('threados-bootstrap-process-')
    roots.push(root)
    const canonical = join(root, 'canonical')
    const runtime = join(root, 'runtime')
    await mkdir(join(canonical, '.threados', 'prompts'), { recursive: true })
    await mkdir(runtime, { recursive: true })
    await writeFile(join(canonical, '.threados', 'prompts', 'execute.md'), 'execute\n')
    await writeFile(join(canonical, 'bootstrap-long.cjs'), [
      "const fs = require('fs')",
      "fs.writeFileSync('bootstrap-observed.json', JSON.stringify({ pid: process.pid, cwd: process.cwd(), basePath: process.env.THREADOS_BASE_PATH }))",
      'setTimeout(() => process.exit(0), 30000)',
    ].join(';'))
    const bootstrapCommand = `${JSON.stringify(process.execPath)} bootstrap-long.cjs`
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
      `bootstrap: [${JSON.stringify(bootstrapCommand)}]`,
      'validate: []',
      '',
    ].join('\n'))

    const sequence: Sequence = {
      version: '1',
      id: 'bootstrap-process-lifecycle',
      name: 'bootstrap-process-lifecycle',
      gates: [],
      steps: [{
        id: 'execute',
        name: 'execute',
        type: 'base',
        model: 'shell',
        prompt_file: '.threados/prompts/execute.md',
        prompt_ref: { id: 'execute', version: 1, path: '.threados/prompts/execute.md' },
        status: 'READY',
        depends_on: [],
        side_effect_class: 'execute',
        workspace_mode: 'isolated',
      }],
    }
    sequence.steps = await registerSequenceAgents(canonical, sequence.steps)
    let agentDispatches = 0
    const service = await getThreadOSRuntimeService(canonical, {
      dependencies: {
        loadSequence: async () => sequence,
        loadPolicy: async () => PolicyConfigSchema.parse({ mode: 'POWER', side_effect_mode: 'free' }),
        validateSequence: () => undefined,
        validatePrompt: async () => true,
        compilePrompt: async () => 'prompt',
        allowModelExecution: () => ({ allowed: true }),
        dispatch: async () => {
          agentDispatches += 1
          throw new Error('agent dispatch must not run after bootstrap cancellation')
        },
      },
    })
    const request = {
      sequence_id: sequence.id!,
      target: { kind: 'step' as const, step_id: 'execute' },
      strategy: 'sequential' as const,
      max_concurrency: 1,
    }
    const context = {
      actor: 'bootstrap-integration',
      interface: 'system' as const,
      idempotencyKey: `start-${randomUUID()}`,
      policyConfirmed: true,
    }
    await service.startRun(request, context)

    let observedPid: number | null = null
    try {
      const workspace = await waitFor(async () => {
        const [candidate] = await new WorkspaceRepository(canonical).list()
        return candidate?.status === 'active' ? candidate : null
      })
      const observed = await waitFor(async () => {
        try {
          return JSON.parse(await readFile(join(workspace.root_path, 'bootstrap-observed.json'), 'utf8')) as {
            pid: number
            cwd: string
            basePath?: string
          }
        } catch {
          return null
        }
      })
      observedPid = observed.pid
      const bootstrapProcess = await waitFor(async () => {
        const [candidate] = await new ProcessRepository(canonical).list()
        return candidate?.status === 'running' ? candidate : null
      })
      const attempt = await new AttemptRepository(canonical).get(bootstrapProcess.attempt_id)

      expect(bootstrapProcess).toMatchObject({
        workspace_id: workspace.id,
        cwd: workspace.root_path,
        attempt_id: attempt!.id,
      })
      expect(bootstrapProcess.environment_keys).not.toContain('THREADOS_BASE_PATH')
      expect(attempt).toMatchObject({ status: 'provisioning', process_id: bootstrapProcess.id })
      expect(observed).toMatchObject({ cwd: workspace.root_path })
      expect(observed.basePath).toBeUndefined()

      const cancelledAt = Date.now()
      const cancelled = await service.cancelAttempt(attempt!.id, {
        actor: 'bootstrap-integration',
        interface: 'system',
        idempotencyKey: `cancel-${randomUUID()}`,
        policyConfirmed: true,
      })
      const terminalProcess = await waitFor(async () => {
        const record = await new ProcessRepository(canonical).get(bootstrapProcess.id)
        return record?.status === 'exited' ? record : null
      })
      const terminalAttempt = await new AttemptRepository(canonical).get(attempt!.id)

      expect(Date.now() - cancelledAt).toBeLessThan(15_000)
      expect(processIsAlive(observed.pid)).toBe(false)
      expect(cancelled.status).toBe('cancelled')
      expect(terminalProcess).toMatchObject({
        workspace_id: workspace.id,
        process_purpose: 'bootstrap',
        process_ordinal: 0,
        status: 'exited',
      })
      expect(terminalProcess.cancellation_requested_at).not.toBeNull()
      expect(terminalAttempt).toMatchObject({ status: 'cancelled', process_id: bootstrapProcess.id })
      expect(agentDispatches).toBe(0)
    } finally {
      try {
        if (observedPid !== null && processIsAlive(observedPid)) {
          process.kill(observedPid, 'SIGKILL')
        }
      } finally {
        // Attempt cancellation can finish before run projections/receipts. Keep
        // this fixture alive until the original idempotent run fully settles.
        await service.runAndWait(request, context)
      }
    }
  }, 30_000)
})


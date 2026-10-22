import { readMergeValidationProcess } from '../merge/process-evidence'
import { RunRepository } from '../runtime/run-repository'
import { WorkspaceRepository } from '../workspaces/repository'
import { ValidationPolicyIntentSchema } from './validation-schema'
import { auditCandidateValidationTree } from './validation-tree'
import { z } from 'zod'
import { allowHostedProcessControls, allowShellModel } from '../hosted'
import { writeFileAtomic } from '../fs/atomic'
import { readTextFileNoFollow } from '../security/safe-io'
import { resolveExistingPathWithinRoot, resolvePathWithinRoot } from '../security/safe-path'
import { parseBootstrapCommand } from '../workspaces/bootstrap'
import { loadWorkspaceConfig } from '../workspaces/config'
import { hashCanonicalJson } from '../workspaces/hash'
import { enforceExecutablePayload } from '../policy/executable'
import { ProcessRepository } from '../runtime/process-repository'
import type { RuntimeServiceDependencies } from '../runtime/service-types'

const Receipt = z.object({ schema_version: z.literal(1), run_id: z.string(), attempt_id: z.string(),
  workspace_id: z.string(), commands_hash: z.string(), policy_hash: z.string(),
  process_ids: z.array(z.string()), status: z.enum(['running', 'passed']),
}).strict()

export async function validateAttemptCandidate(input: Parameters<NonNullable<RuntimeServiceDependencies['validateAttemptWorkspace']>>[0]): Promise<void> {
  const config = await loadWorkspaceConfig(input.basePath)
  if (!config.validate.length) return
  if (!allowHostedProcessControls() || !allowShellModel()) throw new Error('MERGE_VALIDATION_POLICY_DENIED')
  const runRoot = await resolveExistingPathWithinRoot(input.basePath, '.threados', 'runs', input.run.id)
  const intent = ValidationPolicyIntentSchema.parse(JSON.parse(await readTextFileNoFollow(await resolveExistingPathWithinRoot(runRoot, 'validation-policy.json'))))
  if (intent.workflow_run_id !== input.run.id || hashCanonicalJson(input.policy) !== input.run.policy_snapshot_hash
    || intent.commands_hash !== hashCanonicalJson(config.validate)
    || intent.required_commands !== config.validate.length) throw new Error('CHANGE_SET_VALIDATION_POLICY_CHANGED')
  const path = await resolvePathWithinRoot(runRoot, `candidate-validation-${input.attempt.id}.json`)
  const receipt = Receipt.parse({ schema_version: 1, run_id: input.run.id, attempt_id: input.attempt.id,
    workspace_id: input.workspace.context.workspaceId, commands_hash: intent.commands_hash,
    policy_hash: input.run.policy_snapshot_hash, process_ids: [], status: 'running' })
  await writeFileAtomic(path, JSON.stringify(receipt), { allowedRoot: input.basePath })
  for (const source of config.validate) {
    await auditCandidateValidationTree(input.workspace.context.cwd, input.rootIdentity,
      { maxFiles: config.workspace.max_files, maxBytes: config.workspace.max_bytes_each })
    const parsed = parseBootstrapCommand(source)
    const payload = { command: parsed.command, args: parsed.args, cwd: input.workspace.context.cwd }
    const allowed = enforceExecutablePayload(payload, input.policy, input.context.policyConfirmed)
    if (!allowed.allowed || allowed.confirmation_required) throw new Error('MERGE_VALIDATION_POLICY_DENIED')
    const result = await input.execute(payload, { cwd: payload.cwd, shell: false, timeoutMs: 600_000, maxOutputBytes: 64 * 1024 })
    if (result.exitCode !== 0) throw new Error('CHANGE_SET_VALIDATION_FAILED')
  }
  const processes = (await new ProcessRepository(input.basePath).list()).filter(item =>
    item.workflow_run_id === input.run.id && item.attempt_id === input.attempt.id
    && item.workspace_id === receipt.workspace_id && item.process_purpose === 'validation').sort((a, b) => (a.process_ordinal ?? -1) - (b.process_ordinal ?? -1))
  if (processes.length !== config.validate.length || processes.some(item => item.status !== 'exited' || item.exit_code !== 0)) {
    throw new Error('CHANGE_SET_VALIDATION_EVIDENCE_MISSING')
  }
  await writeFileAtomic(path, JSON.stringify({ ...receipt, status: 'passed', process_ids: processes.map(item => item.id) }),
    { allowedRoot: input.basePath })
}

export async function readCandidateValidation(basePath: string, runId: string, attemptId: string,
  workspaceId: string, required: number): Promise<string[] | null> {
  if (!required) return []
  try {
    const root = await resolveExistingPathWithinRoot(basePath, '.threados', 'runs', runId)
    const ref = `candidate-validation-${attemptId}.json`
    const receipt = Receipt.parse(JSON.parse(await readTextFileNoFollow(await resolveExistingPathWithinRoot(root, ref))))
    const intent = ValidationPolicyIntentSchema.parse(JSON.parse(await readTextFileNoFollow(await resolveExistingPathWithinRoot(root, 'validation-policy.json'))))
    if (receipt.status !== 'passed' || receipt.run_id !== runId || receipt.attempt_id !== attemptId
      || receipt.workspace_id !== workspaceId || receipt.commands_hash !== intent.commands_hash
      || intent.required_commands !== required || receipt.process_ids.length !== required
      || new Set(receipt.process_ids).size !== required) return null
    const run = await new RunRepository(basePath).get(runId)
    const workspace = await new WorkspaceRepository(basePath).get(workspaceId)
    const config = await loadWorkspaceConfig(basePath)
    if (!run || !workspace || run.policy_snapshot_hash !== receipt.policy_hash
      || intent.workflow_run_id !== runId || hashCanonicalJson(config.validate) !== intent.commands_hash) return null
    for (const [index, id] of receipt.process_ids.entries()) {
      const process = await readMergeValidationProcess(basePath, { id, runId, attemptId, workspaceId, ordinal: index })
      const command = parseBootstrapCommand(config.validate[index]!)
      if (!process || process.command !== command.command || process.cwd !== workspace.root_path || process.workflow_run_id !== runId || process.attempt_id !== attemptId
        || process.workspace_id !== workspaceId || process.process_purpose !== 'validation'
        || process.process_ordinal !== index || process.status !== 'exited' || process.exit_code !== 0) return null
    }
    return [`.threados/runs/${runId}/${ref}`, ...receipt.process_ids]
  } catch { return null }
}

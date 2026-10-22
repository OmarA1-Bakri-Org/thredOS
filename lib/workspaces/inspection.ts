import type { SurfaceWorkspace, WorkspaceSnapshot } from './schema'
import type { StepAttempt, ProcessRecord } from '../runtime/schema'

export interface WorkspaceBootstrapSummary {
  index: number
  status: 'success' | 'failed' | 'policy_blocked' | 'error'
  duration_ms: number
  exit_code: number | null
}

export interface WorkspaceInspection {
  schema_version: 1
  workspace: SurfaceWorkspace
  snapshot: Pick<WorkspaceSnapshot, 'id' | 'status' | 'root_manifest_hash' | 'file_count' | 'total_bytes' | 'created_at' | 'verified_at'> | null
  manifest_hash: string | null
  attempt: Pick<StepAttempt, 'id' | 'status' | 'step_id' | 'workflow_run_id'> | null
  processes: Pick<ProcessRecord, 'id' | 'attempt_id' | 'status' | 'pid' | 'exit_code' | 'started_at' | 'ended_at'>[]
  verification: { exists: boolean; manifestMatches: boolean | null; hasUsefulOutput: boolean | null }
  bootstrap: WorkspaceBootstrapSummary[]
  diagnostics: { code: string; message: string }[]
}

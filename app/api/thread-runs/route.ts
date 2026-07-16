import { NextResponse } from 'next/server'
import { getBasePath } from '@/lib/config'
import { handleError, requireRequestSession } from '@/lib/api-helpers'
import { readThreadSurfaceState } from '@/lib/thread-surfaces/repository'
import type { RunScope, RunStatus } from '@/lib/thread-surfaces/types'
import { getApiRuntimeService } from '@/lib/api/runtime-request'
import type { WorkflowRunStatus } from '@/lib/runtime/schema'

function compatibilityRunStatus(status: WorkflowRunStatus): RunStatus {
  if (status === 'pending' || status === 'provisioning') return 'pending'
  if (status === 'running' || status === 'applying' || status === 'awaiting_review') return 'running'
  if (status === 'successful' || status === 'partially_successful') return 'successful'
  if (status === 'cancelled') return 'cancelled'
  return 'failed'
}

async function enrichRuntimeTruth(basePath: string, runs: RunScope[]): Promise<RunScope[]> {
  if (!runs.some(run => run.workflowRunId || run.attemptId)) return runs
  const service = await getApiRuntimeService(basePath)
  const runtimeRuns = await service.listRuns()
  const runById = new Map(runtimeRuns.map(projection => [projection.run.id, projection]))
  const attemptIds = new Set(runs.flatMap(run => run.attemptId ? [run.attemptId] : []))
  for (const projection of runtimeRuns) {
    for (const attempt of projection.attempts) {
      if (runs.some(run => run.id === attempt.id)) attemptIds.add(attempt.id)
    }
  }
  const attemptProjections = await Promise.all(
    [...attemptIds].map(attemptId => service.inspectAttempt(attemptId)),
  )
  const attemptById = new Map(
    attemptProjections.map(projection => [projection.attempt.id, projection]),
  )

  return runs.map(run => {
    const attempt = attemptById.get(run.attemptId ?? run.id)
    const workflowRunId = run.workflowRunId ?? attempt?.attempt.workflow_run_id
      ?? (runById.has(run.id) ? run.id : undefined)
    const workflow = workflowRunId ? runById.get(workflowRunId) : undefined
    if (!workflow && !attempt) return run
    const source = workflow?.source ?? attempt?.source
    return {
      ...run,
      ...(workflowRunId ? { workflowRunId } : {}),
      ...(attempt ? { attemptId: attempt.attempt.id } : {}),
      ...(source ? { runtimeSource: source } : {}),
      ...(workflow ? {
        workflowRunStatus: workflow.run.status,
        runStatus: compatibilityRunStatus(workflow.run.status),
      } : {}),
      ...(attempt ? {
        attemptStatus: attempt.attempt.status,
        processStatus: attempt.process?.status,
      } : {}),
    }
  })
}

export async function GET(request: Request) {
  try {
    const session = requireRequestSession(request)
    if (session instanceof NextResponse) return session
    const threadSurfaceId = new URL(request.url).searchParams.get('threadSurfaceId')
    const basePath = getBasePath()
    const state = await readThreadSurfaceState(basePath)
    const projectedRuns = await enrichRuntimeTruth(basePath, state.runs)
    const runs = threadSurfaceId
      ? projectedRuns.filter(run => run.threadSurfaceId === threadSurfaceId)
      : projectedRuns
    return NextResponse.json({ runs })
  } catch (err) {
    return handleError(err)
  }
}

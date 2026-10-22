import { RuntimeServiceError } from '../../runtime/errors'
import type { WorkspaceDoctorReport } from '../../workspaces/doctor'
import type { WorkspaceInspection } from '../../workspaces/inspection'
import type { SurfaceWorkspace } from '../../workspaces/schema'
import { renderRuntimeFailure, renderRuntimeSuccess, type CLIOptions } from '../formatters/runtime'
import { createCLIContext, getCLIRuntimeService } from '../runtime'

function workspaceId(args: string[], action: string): string {
  const value = args[0]?.trim()
  if (!value || args.length !== 1) {
    throw new RuntimeServiceError(
      'VALIDATION_ERROR',
      `Usage: thread workspace ${action} <workspaceId>`,
    )
  }
  return value
}

function inlineRunId(args: string[]): string | undefined {
  if (args.length === 1 && args[0].startsWith('--run=')) {
    const value = args[0].slice('--run='.length).trim()
    if (value) return value
  }
  return undefined
}

function listRunId(args: string[]): string | undefined {
  if (args.length === 0) return undefined
  if (args.length === 2 && args[0] === '--run' && args[1]?.trim()) return args[1].trim()
  const inlineValue = inlineRunId(args)
  if (inlineValue) return inlineValue
  throw new RuntimeServiceError(
    'VALIDATION_ERROR',
    'Usage: thread workspace list [--run <runId>]',
  )
}

function printWorkspace(workspace: SurfaceWorkspace): void {
  console.log(`${workspace.id}: ${workspace.status} (${workspace.isolation_label})`)
  console.log(`  Run: ${workspace.workflow_run_id}`)
  console.log(`  Attempt: ${workspace.attempt_id}`)
  console.log(`  Snapshot: ${workspace.snapshot_id}`)
}

function printInspection(inspection: WorkspaceInspection): void {
  printWorkspace(inspection.workspace)
  console.log(`  Root: ${inspection.workspace.root_path}`)
  console.log(`  Files: ${inspection.workspace.file_count}`)
  console.log(`  Bytes: ${inspection.workspace.total_bytes}`)
  console.log(`  Manifest: ${inspection.manifest_hash ?? 'unavailable'}`)
  console.log(`  Verified: ${inspection.verification.manifestMatches ?? 'unavailable'}`)
  if (inspection.diagnostics.length > 0) {
    console.log('  Diagnostics:')
    for (const diagnostic of inspection.diagnostics) {
      console.log(`    ${diagnostic.code}: ${diagnostic.message}`)
    }
  }
}

function printDoctor(report: WorkspaceDoctorReport): void {
  console.log(report.healthy ? 'Workspace storage is healthy' : 'Workspace storage needs attention')
  console.log(`Records checked: ${report.checkedRecords}`)
  console.log(`Directories checked: ${report.checkedDirectories}`)
  for (const issue of report.issues) {
    const workspace = issue.workspaceId ? ` (${issue.workspaceId})` : ''
    console.log(`  ${issue.code}${workspace}: ${issue.message}`)
  }
}

type WorkspaceCLIService = Awaited<ReturnType<typeof getCLIRuntimeService>>

async function workspaceDoctor(service: WorkspaceCLIService, args: string[], options: CLIOptions): Promise<void> {
  if (args.length !== 0) {
    throw new RuntimeServiceError('VALIDATION_ERROR', 'Usage: thread workspace doctor')
  }
  const report = await service.doctorWorkspaces()
  renderRuntimeSuccess(report, options, () => printDoctor(report))
}

async function executeWorkspaceCommand(
  service: WorkspaceCLIService,
  subcommand: string | undefined,
  args: string[],
  options: CLIOptions,
): Promise<void> {
  switch (subcommand) {
    case 'list': {
      const workspaces = await service.listWorkspaces({ runId: listRunId(args) })
      renderRuntimeSuccess({ workspaces }, options, () => {
        if (workspaces.length === 0) console.log('No workspaces found')
        else workspaces.forEach(printWorkspace)
      })
      return
    }
    case 'inspect': {
      const inspection = await service.inspectWorkspace(workspaceId(args, 'inspect'))
      renderRuntimeSuccess(inspection, options, () => printInspection(inspection))
      return
    }
    case 'retain': {
      const inspection = await service.retainWorkspace(
        workspaceId(args, 'retain'),
        createCLIContext(options),
      )
      renderRuntimeSuccess(inspection, options, () => printInspection(inspection))
      return
    }
    case 'clean': {
      const inspection = await service.cleanWorkspace(
        workspaceId(args, 'clean'),
        createCLIContext(options),
      )
      renderRuntimeSuccess(inspection, options, () => printInspection(inspection))
      return
    }
    case 'doctor': {
      await workspaceDoctor(service, args, options)
      return
    }
    default:
      throw new RuntimeServiceError(
        'VALIDATION_ERROR',
        'Unknown subcommand. Usage: thread workspace list|inspect|retain|clean|doctor',
      )
  }
}

export async function workspaceCommand(
  subcommand: string | undefined,
  args: string[],
  options: CLIOptions,
): Promise<void> {
  try {
    const service = await getCLIRuntimeService(options.basePath ?? process.cwd())
    await executeWorkspaceCommand(service, subcommand, args, options)
  } catch (error) {
    renderRuntimeFailure(error, options)
  }
}

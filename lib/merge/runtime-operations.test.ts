import { createFixtureRoot, removeFixtureTree } from '../../test/helpers/remove-fixture-tree'
import { afterEach, expect, test } from 'bun:test'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { captureChangeSet } from '../changesets/capture'
import { ChangeSetRepository } from '../changesets/repository'
import { buildExclusionPolicy } from '../workspaces/exclusions'
import { readLocalWorkspace } from '../local-first/workspace'
import { createDefaultWorkspaceConfig } from '../workspaces/config-schema'
import { writeWorkspaceConfig } from '../workspaces/config'
import { captureSnapshot } from '../workspaces/snapshot'
import type { SurfaceWorkspace } from '../workspaces/schema'
import { writeThreadSurfaceState } from '../thread-surfaces/repository'
import { MergeRuntimeOperations } from './runtime-operations'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await removeFixtureTree(root)
})

test('real captured Change Set cannot enter merge preview before evidence-backed validation and selection', async () => {
  const root = await createFixtureRoot('threados-merge-runtime-')
  roots.push(root)
  const canonicalRoot = join(root, 'project')
  const runtimeDataRoot = join(root, 'runtime')
  const workspaceRoot = join(root, 'attempt')
  await Promise.all([mkdir(canonicalRoot), mkdir(runtimeDataRoot), mkdir(workspaceRoot)])
  await writeFile(join(canonicalRoot, 'a.txt'), 'baseline\n')
  const config = createDefaultWorkspaceConfig()
  config.runtime_data_root = runtimeDataRoot
  await writeWorkspaceConfig(canonicalRoot, config)
  const local = await readLocalWorkspace(canonicalRoot)
  const captured = await captureSnapshot({ canonicalRoot, runtimeDataRoot,
    localWorkspaceId: local.id, workflowRunId: 'run-1', config },
  { appendTrace: async () => undefined })
  await writeFile(join(workspaceRoot, 'a.txt'), 'candidate\n')
  const workspace = { id: 'workspace-1', root_path: workspaceRoot, status: 'active',
    workflow_run_id: 'run-1', attempt_id: 'attempt-1', surface_id: 'surface-1',
    snapshot_id: captured.snapshot.id, manifest_hash: captured.manifest.root_manifest_hash } as SurfaceWorkspace
  const policy = await buildExclusionPolicy({ canonicalRoot, config, alwaysExcludedRoots: [runtimeDataRoot] })
  const changeSet = await captureChangeSet({ canonicalRoot, runtimeDataRoot,
    namespace: local.runtimeNamespace, workflowRunId: 'run-1', attemptId: 'attempt-1',
    stepId: 'step-1', surfaceId: 'surface-1', agentRef: null, workspace,
    snapshot: captured.snapshot, baselineManifest: captured.manifest, exclusionPolicy: policy,
    maxFiles: 20, maxBytes: 1024, outputContractConfigured: false, createdAt: new Date().toISOString() })
  const repository = new ChangeSetRepository({ canonicalRoot, runtimeDataRoot,
    namespace: local.runtimeNamespace, runId: 'run-1', attemptId: 'attempt-1' })
  expect((await repository.get(changeSet.id))?.validation.status).toBe('pending')
  const operations = new MergeRuntimeOperations(canonicalRoot)
  const shared = { id: 'surface-1', parentSurfaceId: null, parentAgentNodeId: null, depth: 0,
    surfaceLabel: 'Candidate', createdAt: new Date().toISOString(), childSurfaceIds: [],
    sequenceRef: null, spawnedByAgentId: null, surfaceClass: 'shared' as const }
  await writeThreadSurfaceState(canonicalRoot, { version: 1, threadSurfaces: [shared],
    runs: [], mergeEvents: [], runEvents: [] })
  await expect(operations.previewSelected(changeSet.id, 'preview-one')).rejects.toThrow('MERGE_SELECTION_STALE')
  const surface = { ...shared, surfaceLabel: 'Sealed candidate', surfaceClass: 'sealed' as const,
    visibility: 'self_only' as const, isolationLabel: 'THREADOS_SCOPED' as const,
    revealState: 'sealed' as const }
  await writeThreadSurfaceState(canonicalRoot, { version: 1, threadSurfaces: [surface],
    runs: [], mergeEvents: [], runEvents: [] })
  await expect(operations.previewSelected(changeSet.id, 'preview-sealed'))
    .rejects.toMatchObject({ code: 'CHANGE_SET_NOT_REVEALED' })
  expect(await readFile(join(canonicalRoot, 'a.txt'), 'utf8')).toBe('baseline\n')
}, 30_000)

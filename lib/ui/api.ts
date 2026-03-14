'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Sequence } from '@/lib/sequence/schema'
import type { SequenceStatus } from '@/app/api/status/route'
import type { MergeEvent, RunScope, ThreadSurface, ThreadSkillBadge } from '@/lib/thread-surfaces/types'
import type { ThreadCardProfile } from '@/components/hierarchy/FocusedThreadCard'
import { resolveSkillsForAgent } from '@/lib/thread-surfaces/projections'

interface ThreadSurfacesResponse {
  threadSurfaces: ThreadSurface[]
}

interface ThreadRunsResponse {
  runs: RunScope[]
}

interface ThreadMergesResponse {
  mergeEvents: MergeEvent[]
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error || res.statusText)
  }
  return res.json()
}

export function postJson<T>(url: string, body: unknown): Promise<T> {
  return fetchJson<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

function invalidateRuntimeQueries(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['status'] })
  qc.invalidateQueries({ queryKey: ['sequence'] })
  qc.invalidateQueries({ queryKey: ['thread-surfaces'] })
  qc.invalidateQueries({ queryKey: ['thread-runs'] })
  qc.invalidateQueries({ queryKey: ['thread-merges'] })
}

export function unwrapThreadSurfacesResponse(response: ThreadSurfacesResponse): ThreadSurface[] {
  return response.threadSurfaces
}

export function unwrapThreadRunsResponse(response: ThreadRunsResponse): RunScope[] {
  return response.runs
}

export function unwrapThreadMergesResponse(response: ThreadMergesResponse): MergeEvent[] {
  return response.mergeEvents
}

export function useSequence() {
  return useQuery<Sequence>({ queryKey: ['sequence'], queryFn: () => fetchJson('/api/sequence') })
}

export function useStatus() {
  return useQuery<SequenceStatus>({ queryKey: ['status'], queryFn: () => fetchJson('/api/status'), refetchInterval: 2000 })
}

export function useThreadSurfaces() {
  return useQuery<ThreadSurface[]>({
    queryKey: ['thread-surfaces'],
    queryFn: async () => unwrapThreadSurfacesResponse(await fetchJson<ThreadSurfacesResponse>('/api/thread-surfaces')),
    retry: false,
  })
}

export function useThreadRuns(threadSurfaceId?: string | null) {
  const query = threadSurfaceId ? `?threadSurfaceId=${encodeURIComponent(threadSurfaceId)}` : ''
  return useQuery<RunScope[]>({
    queryKey: ['thread-runs', threadSurfaceId ?? null],
    queryFn: async () => unwrapThreadRunsResponse(await fetchJson<ThreadRunsResponse>(`/api/thread-runs${query}`)),
    retry: false,
  })
}

export function useThreadMerges(runId?: string | null) {
  const query = runId ? `?runId=${encodeURIComponent(runId)}` : ''
  return useQuery<MergeEvent[]>({
    queryKey: ['thread-merges', runId ?? null],
    queryFn: async () => unwrapThreadMergesResponse(await fetchJson<ThreadMergesResponse>(`/api/thread-merges${query}`)),
    retry: false,
  })
}

export function useRunStep() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (stepId: string) => postJson('/api/run', { stepId }),
    onSuccess: () => invalidateRuntimeQueries(qc),
    onError: (error) => { console.error('Run step failed:', error) },
  })
}

export function useRunRunnable() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => postJson('/api/run', { mode: 'runnable' }),
    onSuccess: () => invalidateRuntimeQueries(qc),
    onError: (error) => { console.error('Run runnable failed:', error) },
  })
}

export function useStopStep() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (stepId: string) => postJson('/api/stop', { stepId }),
    onSuccess: () => invalidateRuntimeQueries(qc),
    onError: (error) => { console.error('Stop step failed:', error) },
  })
}

export function useRestartStep() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (stepId: string) => postJson('/api/restart', { stepId }),
    onSuccess: () => invalidateRuntimeQueries(qc),
    onError: (error) => { console.error('Restart step failed:', error) },
  })
}

export function useApproveGate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (gateId: string) => postJson('/api/gate', { action: 'approve', gateId }),
    onSuccess: () => invalidateRuntimeQueries(qc),
    onError: (error) => { console.error('Approve gate failed:', error) },
  })
}

export function useBlockGate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (gateId: string) => postJson('/api/gate', { action: 'block', gateId }),
    onSuccess: () => invalidateRuntimeQueries(qc),
    onError: (error) => { console.error('Block gate failed:', error) },
  })
}

export function useRemoveGate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (gateId: string) => postJson('/api/gate', { action: 'rm', gateId }),
    onSuccess: () => invalidateRuntimeQueries(qc),
    onError: (error) => { console.error('Remove gate failed:', error) },
  })
}

// ── Construction mutations ──────────────────────────────────────────

export interface AddStepInput {
  stepId: string
  name?: string
  type?: string
  model?: string
  prompt?: string
  dependsOn?: string[]
}

export function useAddStep() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: AddStepInput) => postJson('/api/step', { action: 'add', ...input }),
    onSuccess: () => invalidateRuntimeQueries(qc),
    onError: (error) => { console.error('Add step failed:', error) },
  })
}

export interface EditStepInput {
  stepId: string
  name?: string
  type?: string
  model?: string
  prompt?: string
  status?: string
  dependsOn?: string[]
}

export function useEditStep() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: EditStepInput) => postJson('/api/step', { action: 'edit', ...input }),
    onSuccess: () => invalidateRuntimeQueries(qc),
    onError: (error) => { console.error('Edit step failed:', error) },
  })
}

export function useRemoveStep() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (stepId: string) => postJson('/api/step', { action: 'rm', stepId }),
    onSuccess: () => invalidateRuntimeQueries(qc),
    onError: (error) => { console.error('Remove step failed:', error) },
  })
}

export function useCloneStep() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ sourceId, newId }: { sourceId: string; newId: string }) =>
      postJson('/api/step', { action: 'clone', sourceId, newId }),
    onSuccess: () => invalidateRuntimeQueries(qc),
    onError: (error) => { console.error('Clone step failed:', error) },
  })
}

export function useInsertGate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { gateId: string; name?: string; dependsOn?: string[] }) =>
      postJson('/api/gate', { action: 'insert', ...input }),
    onSuccess: () => invalidateRuntimeQueries(qc),
    onError: (error) => { console.error('Insert gate failed:', error) },
  })
}

export function useAddDep() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ stepId, depId }: { stepId: string; depId: string }) =>
      postJson('/api/dep', { action: 'add', stepId, depId }),
    onSuccess: () => invalidateRuntimeQueries(qc),
    onError: (error) => { console.error('Add dependency failed:', error) },
  })
}

// ── Agent profile query ─────────────────────────────────────────────

interface AgentProfileResponse {
  profile: ThreadCardProfile | null
}

export function useAgentProfile(threadSurfaceId: string | null) {
  return useQuery<ThreadCardProfile | null>({
    queryKey: ['agent-profile', threadSurfaceId],
    queryFn: async () => {
      if (!threadSurfaceId) return null
      const res = await fetchJson<AgentProfileResponse>(`/api/agent-profile?threadSurfaceId=${encodeURIComponent(threadSurfaceId)}`)
      return res.profile
    },
    enabled: !!threadSurfaceId,
    retry: false,
    staleTime: 30_000,
  })
}

// ── Thread surface skill query ──────────────────────────────────────

/**
 * Resolve skills for a thread surface by fetching its agent profile
 * and extracting the skill list. Falls back to default skills when
 * the surface has no registered agent.
 */
export function useThreadSurfaceSkills(threadSurfaceId: string | null) {
  const { data: profile } = useAgentProfile(threadSurfaceId)

  return useQuery<ThreadSkillBadge[]>({
    queryKey: ['thread-surface-skills', threadSurfaceId, profile],
    queryFn: () => {
      if (profile?.skills) {
        return profile.skills.map(s => ({
          id: s.id,
          label: s.label,
          inherited: s.inherited,
        }))
      }
      return resolveSkillsForAgent(null)
    },
    enabled: !!threadSurfaceId,
    staleTime: 30_000,
  })
}

export function useResetSequence() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { name?: string }) => postJson('/api/sequence', { action: 'reset', name: input.name }),
    onSuccess: () => invalidateRuntimeQueries(qc),
    onError: (error) => { console.error('Reset sequence failed:', error) },
  })
}

export function useRemoveDep() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ stepId, depId }: { stepId: string; depId: string }) =>
      postJson('/api/dep', { action: 'rm', stepId, depId }),
    onSuccess: () => invalidateRuntimeQueries(qc),
    onError: (error) => { console.error('Remove dependency failed:', error) },
  })
}

'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Sequence } from '@/lib/sequence/schema'
import type { SequenceStatus } from '@/app/api/status/route'
import type { MergeEvent, RunScope, ThreadSurface, ThreadSkillBadge } from '@/lib/thread-surfaces/types'
import type { ThreadCardProfile } from '@/components/hierarchy/FocusedThreadCard'
import type { AgentRegistration } from '@/lib/agents/types'
import type { GateMetrics } from '@/lib/gates/metrics'
import type { ActivationSession } from '@/lib/local-first/types'
import type { LocalWorkspace } from '@/lib/local-first/types'
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
  if (res.status === 401 && typeof window !== 'undefined') {
    const next = `${window.location.pathname}${window.location.search}`
    window.location.href = `/login?next=${encodeURIComponent(next)}`
    throw new Error('Authentication required')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error || res.statusText)
  }
  return res.json()
}

export function postJson<T>(url: string, body: unknown): Promise<T> {
  return fetchJson<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

export interface DesktopEntitlementSnapshot {
  state: {
    status: 'inactive' | 'pending' | 'active' | 'grace' | 'expired'
    plan: 'desktop-public-beta'
    customerEmail: string | null
    activatedAt: string | null
    lastValidatedAt: string | null
    expiresAt: string | null
    graceUntil: string | null
    activationSource: 'browser-return' | 'manual' | 'development'
  }
  effectiveStatus: 'inactive' | 'pending' | 'active' | 'grace' | 'expired'
  isUsable: boolean
}

export interface CloudAgentRegistration {
  registrationNumber: string
  agentId: string
  identityHash: string
  version: number
  registeredAt: string
  supersedesRegistrationNumber: string | null
  name: string
  model: string
  role: string
  skillIds: string[]
  tools: string[]
}

export interface AgentPerformanceRecord {
  id: string
  registrationNumber: string
  recordedAt: string
  outcome: 'pass' | 'fail' | 'needs_review'
  durationMs: number | null
  qualityScore: number | null
  notes: string | null
}

export function startSignIn(): Promise<ActivationSession> {
  return postJson<ActivationSession>('/api/desktop/auth/start', {})
}

export function startCheckout(email?: string): Promise<ActivationSession> {
  return postJson<ActivationSession>('/api/desktop/checkout/start', {
    plan: 'desktop-public-beta',
    ...(email ? { email } : {}),
  })
}

export function completeActivation(token: string): Promise<DesktopEntitlementSnapshot> {
  return postJson<DesktopEntitlementSnapshot>('/api/desktop/activation/complete', { token })
}

export function useDesktopEntitlement() {
  return useQuery<DesktopEntitlementSnapshot>({
    queryKey: ['desktop-entitlement'],
    queryFn: () => fetchJson<DesktopEntitlementSnapshot>('/api/desktop/entitlement'),
    staleTime: 30_000,
  })
}

export function useLocalWorkspace() {
  return useQuery<LocalWorkspace>({
    queryKey: ['local-workspace'],
    queryFn: async () => {
      const response = await fetchJson<{ workspace: LocalWorkspace }>('/api/desktop/workspace')
      return response.workspace
    },
    staleTime: 30_000,
  })
}

export function useRefreshDesktopEntitlement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => postJson<DesktopEntitlementSnapshot>('/api/desktop/entitlement', {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['desktop-entitlement'] })
    },
  })
}

export function fetchAgentRegistration(agentId: string): Promise<CloudAgentRegistration | null> {
  return fetchJson<{ registration: CloudAgentRegistration | null }>(`/api/agent-cloud/registration?agentId=${encodeURIComponent(agentId)}`)
    .then(response => response.registration)
}

export function registerAgentCloud(agentId: string): Promise<CloudAgentRegistration> {
  return postJson<{ registration: CloudAgentRegistration }>('/api/agent-cloud/registration', { agentId })
    .then(response => response.registration)
}

export function fetchAgentPerformance(registrationNumber: string): Promise<AgentPerformanceRecord[]> {
  return fetchJson<{ records: AgentPerformanceRecord[] }>(`/api/agent-cloud/performance?registrationNumber=${encodeURIComponent(registrationNumber)}`)
    .then(response => response.records)
}

export function recordAgentPerformance(input: {
  registrationNumber: string
  outcome: 'pass' | 'fail' | 'needs_review'
  durationMs?: number | null
  qualityScore?: number | null
  notes?: string | null
}): Promise<AgentPerformanceRecord> {
  return postJson<{ record: AgentPerformanceRecord }>('/api/agent-cloud/performance', input)
    .then(response => response.record)
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
    mutationFn: (input: string | { stepId: string; confirmPolicy?: boolean }) => {
      const payload = typeof input === 'string' ? { stepId: input } : input
      return postJson('/api/run', payload)
    },
    onSuccess: () => invalidateRuntimeQueries(qc),
    onError: (error) => { console.error('Run step failed:', error) },
  })
}

export function useRunRunnable() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input?: { confirmPolicy?: boolean }) => postJson('/api/run', { mode: 'runnable', ...input }),
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
    mutationFn: ({ gateId, acknowledged_conditions }: { gateId: string; acknowledged_conditions?: boolean }) =>
      postJson('/api/gate', { action: 'approve', gateId, acknowledged_conditions }),
    onSuccess: () => invalidateRuntimeQueries(qc),
    onError: (error) => { console.error('Approve gate failed:', error) },
  })
}

export function useUpdateGate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      gateId: string; name?: string; description?: string;
      acceptance_conditions?: string[]; required_review?: boolean;
    }) => postJson('/api/gate', { action: 'update', ...input }),
    onSuccess: () => invalidateRuntimeQueries(qc),
    onError: (error) => { console.error('Update gate failed:', error) },
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

// ── Agent CRUD hooks ─────────────────────────────────────────────────

export function useListAgents() {
  return useQuery<AgentRegistration[]>({
    queryKey: ['agents'],
    queryFn: async () => {
      const res = await fetchJson<{ agents: AgentRegistration[] }>('/api/agents')
      return res.agents
    },
    staleTime: 30_000,
  })
}

export function useRegisterAgent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      id: string; name: string; builderId: string; builderName: string;
      model?: string; skills?: Array<{ id: string; label: string }>
    }) => postJson('/api/agents', input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['agents'] }) },
    onError: (error) => { console.error('Register agent failed:', error) },
  })
}

export function useAssignAgent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ stepId, agentId }: { stepId: string; agentId: string | null }) =>
      postJson('/api/step', { action: 'edit', stepId, assignedAgentId: agentId }),
    onSuccess: () => invalidateRuntimeQueries(qc),
    onError: (error) => { console.error('Assign agent failed:', error) },
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

export function useRenameSequence() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => postJson('/api/sequence', { action: 'rename', name }),
    onSuccess: () => invalidateRuntimeQueries(qc),
    onError: (error) => { console.error('Rename sequence failed:', error) },
  })
}

export function useSetThreadType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (thread_type: string) => postJson('/api/sequence', { action: 'set-type', thread_type }),
    onSuccess: () => invalidateRuntimeQueries(qc),
    onError: (error) => { console.error('Set thread type failed:', error) },
  })
}

export function useApplyTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: { type: string; name: string }) =>
      postJson('/api/sequence', { action: 'apply-template', ...args }),
    onSuccess: () => invalidateRuntimeQueries(qc),
    onError: (error) => { console.error('Apply template failed:', error) },
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

// ── Agent performance query ──────────────────────────────────────────

export interface AgentPerformanceData {
  totalRuns: number
  passRate: number
  avgTimeMs: number
  quality: number
}

export function useAgentPerformance(agentId: string | null) {
  return useQuery<AgentPerformanceData | null>({
    queryKey: ['agent-performance', agentId],
    queryFn: async () => {
      if (!agentId) return null
      const res = await fetchJson<{ stats: AgentPerformanceData | null }>(`/api/agent-stats?agentId=${encodeURIComponent(agentId)}`)
      return res.stats
    },
    enabled: !!agentId,
    staleTime: 30_000,
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

// ── Gate metrics query ──────────────────────────────────────────────

export function useGateMetrics(gateId: string | null) {
  return useQuery<GateMetrics | null>({
    queryKey: ['gate-metrics', gateId],
    queryFn: async () => {
      if (!gateId) return null
      const res = await fetchJson<{ metrics: GateMetrics }>(`/api/gate-metrics?gateId=${encodeURIComponent(gateId)}`)
      return res.metrics
    },
    enabled: !!gateId,
    staleTime: 30_000,
  })
}

// ── Packs hooks ─────────────────────────────────────────────────────
import type { Pack } from '@/lib/packs/types'

export function useListPacks() {
  return useQuery<Pack[]>({
    queryKey: ['packs'],
    queryFn: async () => {
      const res = await fetchJson<{ packs: Pack[] }>('/api/packs')
      return res.packs
    },
    staleTime: 30_000,
  })
}

export function useCreatePack() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      id: string; type: string; division?: string; classification?: string;
      builderId: string; builderName: string;
    }) => postJson('/api/packs', { action: 'create', ...input }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['packs'] }) },
    onError: (error) => { console.error('Create pack failed:', error) },
  })
}

export function usePromotePack() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (packId: string) => postJson('/api/packs', { action: 'promote', packId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['packs'] }) },
    onError: (error) => { console.error('Promote pack failed:', error) },
  })
}

// ── Builder profile hook ────────────────────────────────────────────
import type { BuilderProfile } from '@/lib/builders/types'

export function useBuilderProfile(builderId: string | null) {
  return useQuery<BuilderProfile | null>({
    queryKey: ['builder-profile', builderId],
    queryFn: async () => {
      if (!builderId) return null
      const res = await fetchJson<{ profile: BuilderProfile }>(`/api/builder-profile?builderId=${encodeURIComponent(builderId)}`)
      return res.profile
    },
    enabled: !!builderId,
    staleTime: 30_000,
  })
}

// ── Thread Runner eligibility hook ──────────────────────────────────
import type { EligibilityStatus } from '@/lib/thread-runner/types'

export function useThreadRunnerEligibility() {
  return useQuery<EligibilityStatus>({
    queryKey: ['thread-runner-eligibility'],
    queryFn: async () => {
      try {
        return await fetchJson<EligibilityStatus>('/api/thread-runner/eligibility')
      } catch {
        return {
          eligible: false,
          requirements: [],
        }
      }
    },
    staleTime: 60_000,
  })
}

// ── Optimize workflow hook ──────────────────────────────────────────
import type { OptimizationResult } from '@/lib/autoresearch/types'

export function useOptimizeWorkflow() {
  const qc = useQueryClient()
  return useMutation<OptimizationResult>({
    mutationFn: () => postJson<OptimizationResult>('/api/optimize', {}),
    onSuccess: () => invalidateRuntimeQueries(qc),
    onError: (error) => { console.error('Optimize workflow failed:', error) },
  })
}

// ── Thread Runner race hooks ─────────────────────────────────────────

export function useListRaces() {
  return useQuery<import('@/lib/thread-runner/types').Race[]>({
    queryKey: ['thread-runner-races'],
    queryFn: async () => {
      try {
        const res = await fetchJson<{ races: import('@/lib/thread-runner/types').Race[] }>('/api/thread-runner/race')
        return res.races
      } catch {
        return []
      }
    },
    staleTime: 10_000,
  })
}

export function useRaceResults(raceId: string | null) {
  return useQuery<import('@/lib/thread-runner/types').RaceResult | null>({
    queryKey: ['thread-runner-race-results', raceId],
    queryFn: async () => {
      if (!raceId) return null
      try {
        const res = await fetchJson<{ results: import('@/lib/thread-runner/types').RaceResult }>(
          `/api/thread-runner/race?raceId=${encodeURIComponent(raceId)}`
        )
        return res.results
      } catch {
        return null
      }
    },
    enabled: !!raceId,
    staleTime: 5_000,
  })
}

export function useEnrollRace() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string; division: string; classification: string; maxCombatants?: number }) =>
      postJson('/api/thread-runner/race', { action: 'enroll', ...input }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['thread-runner-races'] }) },
  })
}

export function useRecordRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { raceId: string; combatantId: string; threadSurfaceId: string }) =>
      postJson('/api/thread-runner/race', { action: 'record-run', ...input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['thread-runner-races'] })
      qc.invalidateQueries({ queryKey: ['thread-runner-race-results'] })
    },
  })
}

// ── V.1: Traces ─────────────────────────────────────────────────────

export function useTraces(runId: string | null) {
  return useQuery({
    queryKey: ['traces', runId],
    queryFn: () => fetchJson<{ events: unknown[] }>(`/api/traces?runId=${runId}`).then(r => r.events),
    enabled: !!runId,
  })
}

// ── V.1: Approvals ─────────────────────────────────────────────────

export function useApprovals(runId: string | null) {
  return useQuery({
    queryKey: ['approvals', runId],
    queryFn: () => fetchJson<{ approvals: unknown[] }>(`/api/approvals?runId=${runId}`).then(r => r.approvals),
    enabled: !!runId,
  })
}

export function useRequestApproval() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (params: { runId: string; action_type: string; target_ref: string }) =>
      fetchJson('/api/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request', ...params }),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['approvals'] }) },
  })
}

export function useResolveApproval() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (params: Record<string, unknown>) =>
      fetchJson('/api/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve', ...params }),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['approvals'] }) },
  })
}

// ── V.1: Surface Reveal ─────────────────────────────────────────────

export function useRevealSurface() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (params: { surfaceId: string; runId?: string }) =>
      fetchJson('/api/surfaces/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['thread-surfaces'] })
      qc.invalidateQueries({ queryKey: ['traces'] })
    },
  })
}

// ── V.1: Export Bundle ──────────────────────────────────────────────

export function useExportBundle() {
  return useMutation({
    mutationFn: (params: { runId: string }) =>
      fetchJson('/api/exports/run-bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      }),
  })
}

// ── V.1: Surface Access ─────────────────────────────────────────────

export function useSurfaceAccess(surfaceId: string | null, requestorSurfaceId: string | null) {
  return useQuery({
    queryKey: ['surface-access', surfaceId, requestorSurfaceId],
    queryFn: () => fetchJson<{ access: unknown }>(`/api/surfaces/access?surfaceId=${surfaceId}&requestorSurfaceId=${requestorSurfaceId}`).then(r => r.access),
    enabled: !!surfaceId && !!requestorSurfaceId,
  })
}

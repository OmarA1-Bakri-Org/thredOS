'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Sequence } from '@/lib/sequence/schema'
import type { SequenceStatus } from '@/app/api/status/route'
import type { MergeEvent, RunScope, ThreadSurface } from '@/lib/thread-surfaces/types'

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error || res.statusText)
  }
  return res.json()
}

function postJson<T>(url: string, body: unknown): Promise<T> {
  return fetchJson<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
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
    queryFn: () => fetchJson('/api/thread-surfaces'),
    retry: false,
  })
}

export function useThreadRuns(threadSurfaceId?: string | null) {
  const query = threadSurfaceId ? `?threadSurfaceId=${encodeURIComponent(threadSurfaceId)}` : ''
  return useQuery<RunScope[]>({
    queryKey: ['thread-runs', threadSurfaceId ?? null],
    queryFn: () => fetchJson(`/api/thread-runs${query}`),
    retry: false,
  })
}

export function useThreadMerges(runId?: string | null) {
  const query = runId ? `?runId=${encodeURIComponent(runId)}` : ''
  return useQuery<MergeEvent[]>({
    queryKey: ['thread-merges', runId ?? null],
    queryFn: () => fetchJson(`/api/thread-merges${query}`),
    retry: false,
  })
}

export function useRunStep() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (stepId: string) => postJson('/api/run', { stepId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['status'] }); qc.invalidateQueries({ queryKey: ['sequence'] }) },
    onError: (error) => { console.error('Run step failed:', error) },
  })
}

export function useRunRunnable() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => postJson('/api/run', { mode: 'runnable' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['status'] }); qc.invalidateQueries({ queryKey: ['sequence'] }) },
    onError: (error) => { console.error('Run runnable failed:', error) },
  })
}

export function useStopStep() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (stepId: string) => postJson('/api/stop', { stepId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['status'] }); qc.invalidateQueries({ queryKey: ['sequence'] }) },
    onError: (error) => { console.error('Stop step failed:', error) },
  })
}

export function useRestartStep() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (stepId: string) => postJson('/api/restart', { stepId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['status'] }); qc.invalidateQueries({ queryKey: ['sequence'] }) },
    onError: (error) => { console.error('Restart step failed:', error) },
  })
}

export function useApproveGate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (gateId: string) => postJson('/api/gate', { action: 'approve', gateId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['status'] }); qc.invalidateQueries({ queryKey: ['sequence'] }) },
    onError: (error) => { console.error('Approve gate failed:', error) },
  })
}

export function useBlockGate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (gateId: string) => postJson('/api/gate', { action: 'block', gateId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['status'] }); qc.invalidateQueries({ queryKey: ['sequence'] }) },
    onError: (error) => { console.error('Block gate failed:', error) },
  })
}

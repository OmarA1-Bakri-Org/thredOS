import { describe, expect, it } from 'bun:test'
import { createBarrierAttestation } from './barrier-attestation'

describe('createBarrierAttestation', () => {
  it('creates attestation for a sealed surface with reads denied and no shared projection', () => {
    const attestation = createBarrierAttestation({
      surfaceId: 'surface-001',
      runId: 'run-001',
      isolationLabel: 'THREADOS_SCOPED',
      revealState: 'sealed',
    })

    expect(attestation.surface_id).toBe('surface-001')
    expect(attestation.run_id).toBe('run-001')
    expect(attestation.isolation_label).toBe('THREADOS_SCOPED')
    expect(attestation.reveal_state).toBe('sealed')
    expect(attestation.cross_surface_reads_denied).toBe(true)
    expect(attestation.shared_semantic_projection).toBe(false)
  })

  it('creates attestation for a revealed surface with reads allowed and shared projection active', () => {
    const attestation = createBarrierAttestation({
      surfaceId: 'surface-002',
      runId: 'run-002',
      isolationLabel: 'HOST_ENFORCED',
      revealState: 'revealed',
    })

    expect(attestation.surface_id).toBe('surface-002')
    expect(attestation.run_id).toBe('run-002')
    expect(attestation.isolation_label).toBe('HOST_ENFORCED')
    expect(attestation.reveal_state).toBe('revealed')
    expect(attestation.cross_surface_reads_denied).toBe(false)
    expect(attestation.shared_semantic_projection).toBe(true)
  })

  it('includes contamination_events when provided', () => {
    const events = ['read-from-surface-a', 'write-to-surface-b']
    const attestation = createBarrierAttestation({
      surfaceId: 'surface-003',
      runId: 'run-003',
      isolationLabel: 'NONE',
      revealState: 'sealed',
      contaminationEvents: events,
    })

    expect(attestation.contamination_events).toEqual(events)
  })

  it('defaults contamination_events to an empty array when not provided', () => {
    const attestation = createBarrierAttestation({
      surfaceId: 'surface-004',
      runId: 'run-004',
      isolationLabel: 'NONE',
      revealState: 'revealed',
    })

    expect(attestation.contamination_events).toEqual([])
  })
})

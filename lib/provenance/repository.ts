import { existsSync } from 'fs'
import { mkdir, readFile } from 'fs/promises'
import { join } from 'path'
import { writeFileAtomic } from '@/lib/fs/atomic'
import type { ProvenanceRecord, ProvenanceState } from './types'

const PROVENANCE_STATE_PATH = '.threados/state/provenance.json'

const DEFAULT_PROVENANCE_STATE: ProvenanceState = {
  version: 1,
  records: [],
}

export function getProvenanceStatePath(basePath: string): string {
  return join(basePath, PROVENANCE_STATE_PATH)
}

export async function readProvenanceState(basePath: string): Promise<ProvenanceState> {
  const fullPath = getProvenanceStatePath(basePath)
  if (!existsSync(fullPath)) {
    return structuredClone(DEFAULT_PROVENANCE_STATE)
  }

  const raw = JSON.parse(await readFile(fullPath, 'utf-8')) as Partial<ProvenanceState>

  return {
    version: 1,
    records: Array.isArray(raw.records) ? raw.records : [],
  }
}

export async function writeProvenanceState(basePath: string, state: ProvenanceState): Promise<void> {
  const fullPath = getProvenanceStatePath(basePath)
  await mkdir(join(basePath, '.threados/state'), { recursive: true })
  await writeFileAtomic(fullPath, `${JSON.stringify({ ...state, version: 1 }, null, 2)}\n`)
}

export async function updateProvenanceState(
  basePath: string,
  updater: (currentState: ProvenanceState) => ProvenanceState | Promise<ProvenanceState>,
): Promise<ProvenanceState> {
  const currentState = await readProvenanceState(basePath)
  const nextState = await updater(currentState)
  await writeProvenanceState(basePath, nextState)
  return nextState
}

export async function appendProvenanceRecord(
  basePath: string,
  record: ProvenanceRecord,
): Promise<void> {
  await updateProvenanceState(basePath, (state) => ({
    ...state,
    records: [...state.records, record],
  }))
}

import { lstat } from 'node:fs/promises'
import { readTextFileNoFollow } from '../security/safe-io'
import { WindowsHelperJournalSchema, type WindowsHelperJournal } from './windows-helper-types'

const MAX_OUTPUT_BYTES = 16 * 1024
type PidProbe = (pid: number) => void
export type HelperProcessEvidence = 'pid-live-unverified' | 'pid-absent'
  | 'pid-not-recorded' | 'pid-probe-inconclusive'

function probeProcess(pid: number, probePid: PidProbe): HelperProcessEvidence {
  try {
    probePid(pid)
    return 'pid-live-unverified'
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'ESRCH'
      ? 'pid-absent' : 'pid-probe-inconclusive'
  }
}

function claimedOutcome(journal: WindowsHelperJournal, processEvidence: HelperProcessEvidence) {
  if (journal.phase === 'terminal') {
    if (journal.result === 'succeeded') return 'succeeded'
  }
  if (processEvidence === 'pid-absent' && (journal.phase === 'launch' || journal.phase === 'prepared')) {
    return 'failed-before-start'
  }
  return 'mutation-uncertain'
}

export async function readWindowsHelperJournal(journalPath: string): Promise<WindowsHelperJournal> {
  const stat = await lstat(journalPath)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_OUTPUT_BYTES) {
    throw new Error('MERGE_HELPER_INVALID_JOURNAL')
  }
  return WindowsHelperJournalSchema.parse(JSON.parse(await readTextFileNoFollow(journalPath)))
}

export async function classifyWindowsHelperRecovery(journalPath: string,
  probePid: PidProbe = pid => { process.kill(pid, 0) }): Promise<{
  status: 'requires-review'
  journalClaim: 'succeeded' | 'failed-before-start' | 'mutation-uncertain'
  processEvidence: HelperProcessEvidence
  journal: WindowsHelperJournal
}> {
  const journal = await readWindowsHelperJournal(journalPath)
  const processEvidence = journal.pid === null ? 'pid-not-recorded' : probeProcess(journal.pid, probePid)
  const journalClaim = claimedOutcome(journal, processEvidence)
  // A journal, even a terminal one, is not the current plan/root/identity proof.
  return { status: 'requires-review', journalClaim, processEvidence, journal }
}

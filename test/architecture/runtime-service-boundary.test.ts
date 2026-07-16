import { describe, expect, test } from 'bun:test'
import { readFile } from 'fs/promises'
import { join } from 'path'

const LIFECYCLE_HANDLERS: string[] = [
  'app/api/run/route.ts',
  'app/api/stop/route.ts',
  'app/api/restart/route.ts',
  'app/api/status/route.ts',
  'app/api/runs/route.ts',
  'app/api/runs/[runId]/route.ts',
  'app/api/runs/[runId]/attempts/route.ts',
  'app/api/runs/[runId]/cancel/route.ts',
  'app/api/attempts/[attemptId]/route.ts',
  'app/api/attempts/[attemptId]/cancel/route.ts',
  'app/api/attempts/[attemptId]/retry/route.ts',
  'lib/seqctl/commands/run.ts',
  'lib/seqctl/commands/control.ts',
  'lib/seqctl/commands/status.ts',
  'lib/seqctl/commands/attempt.ts',
]

const FORBIDDEN_IMPORTS = [
  /(?:@\/|\.\.\/)+(?:lib\/)?runner\/(?:wrapper|dispatch|artifacts|prompt-compiler|process-handle)/,
  /(?:@\/|\.\.\/)+(?:lib\/)?runtime\/(?:attempt-executor|process-controller|lifecycle|scheduler)/,
  /(?:@\/|\.\.\/)+(?:lib\/)?mprocs\//,
  /(?:@\/|\.\.\/)+(?:lib\/)?thread-surfaces\/(?:mutations|step-run-runtime|repository)/,
  /(?:@\/|\.\.\/)+(?:lib\/)?reconciliation\//,
  /(?:@\/|\.\.\/)+(?:lib\/)?gates\/(?:engine|rules)/,
  /(?:@\/|\.\.\/)+(?:lib\/)?approvals\//,
] as const

const FORBIDDEN_LIFECYCLE_CALLS = [
  /\b(?:transitionRun|transitionAttempt|transitionProcess)\s*\(/,
  /\b(?:startProcess|runStep|dispatch|executeStep)\s*\(/,
  /\b(?:writeSequence|writeThreadSurfaceState)\s*\(/,
  /\bnew\s+(?:RunRepository|AttemptRepository|ProcessRepository|SequentialScheduler)\b/,
] as const

describe('runtime service architecture boundary', () => {
  test.each(LIFECYCLE_HANDLERS)('%s delegates lifecycle ownership', async relativePath => {
    const source = await readFile(join(process.cwd(), relativePath), 'utf8')
    for (const pattern of FORBIDDEN_IMPORTS) {
      expect(source).not.toMatch(pattern)
    }
    for (const pattern of FORBIDDEN_LIFECYCLE_CALLS) {
      expect(source).not.toMatch(pattern)
    }
  })

  test('all mutable resource handlers resolve the shared runtime service', async () => {
    for (const relativePath of LIFECYCLE_HANDLERS.filter(path => path.startsWith('app/api/'))) {
      const source = await readFile(join(process.cwd(), relativePath), 'utf8')
      expect(source).toContain('getApiRuntimeService')
    }
  })
})

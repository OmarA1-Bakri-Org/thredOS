import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import {
  REQUIRED_M0_PROOF_FILES,
  normalizeProofValue,
  scanRuntimeServiceBoundary,
  validateM0ProofBundle,
  withoutThreadOSBasePath,
} from './m0-proof-helpers'
import {
  RUNTIME_LIFECYCLE_INTERFACE_CLASSIFICATIONS,
  RUNTIME_LIFECYCLE_INTERFACE_ROOTS,
  type RuntimeLifecycleFileSystem,
} from './runtime-lifecycle-interfaces'

describe('M0 proof normalization', () => {
  test('preserves meaningful content hashes while removing interface-only differences', () => {
    expect(normalizeProofValue({
      created_via: 'cli',
      request_hash: 'interface-request',
      sequence_snapshot_hash: 'sequence-content',
      compiled_prompt_hash: 'prompt-content',
    }, 'C:\\fixture')).toEqual({
      created_via: '<interface>',
      request_hash: '<interface-request-hash>',
      sequence_snapshot_hash: 'sequence-content',
      compiled_prompt_hash: 'prompt-content',
    })
  })
})

describe('M0 proof subprocess environment', () => {
  test('removes both supported runtime base-path aliases', () => {
    const sanitized = withoutThreadOSBasePath({
      THREDOS_BASE_PATH: 'C:\\fixture-a',
      THREADOS_BASE_PATH: 'C:\\fixture-b',
      PATH: 'C:\\tools',
    })
    expect(sanitized.PATH).toBe('C:\\tools')
    expect('THREDOS_BASE_PATH' in sanitized).toBe(false)
    expect('THREADOS_BASE_PATH' in sanitized).toBe(false)
  })
})

describe('M0 proof bundle validation', () => {
  test('accepts the complete canonical evidence layout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threados-m0-proof-shape-'))
    try {
      await mkdir(root, { recursive: true })
      await Promise.all(REQUIRED_M0_PROOF_FILES.map(fileName =>
        writeFile(join(root, fileName), `${fileName}\n`, 'utf8'),
      ))

      await expect(validateM0ProofBundle(root)).resolves.toEqual({
        valid: true,
        missing: [],
        empty: [],
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('reports missing and empty evidence explicitly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threados-m0-proof-invalid-'))
    try {
      await writeFile(join(root, REQUIRED_M0_PROOF_FILES[0]), '', 'utf8')

      const result = await validateM0ProofBundle(root)
      expect(result.valid).toBe(false)
      expect(result.empty).toEqual([REQUIRED_M0_PROOF_FILES[0]])
      expect(result.missing).toEqual(REQUIRED_M0_PROOF_FILES.slice(1))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

async function writeFixtureFiles(
  root: string,
  files: Record<string, string>,
): Promise<void> {
  await Promise.all(RUNTIME_LIFECYCLE_INTERFACE_ROOTS.map(relativeDir =>
    mkdir(join(root, ...relativeDir.split('/')), { recursive: true }),
  ))
  await Promise.all(Object.entries(files).map(async ([relativePath, content]) => {
    const fullPath = join(root, ...relativePath.split('/'))
    await mkdir(dirname(fullPath), { recursive: true })
    await writeFile(fullPath, content, 'utf8')
  }))
}

describe('runtime service boundary scan', () => {
  test('fails closed when a discovered API lifecycle delegate is unclassified', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threados-runtime-boundary-unclassified-'))
    try {
      await writeFixtureFiles(root, {
        'app/api/run/route.ts': `
          import { getApiRuntimeService } from '@/lib/api/runtime-request'
          export async function POST() {
            return getApiRuntimeService('fixture')
          }
        `,
        'app/api/runtime-probe/route.ts': `
          export async function GET() {
            return (await import('@/lib/api/runtime-request')).getApiRuntimeService('fixture')
          }
        `,
      })

      const report = await scanRuntimeServiceBoundary(root, {
        classifications: [{
          file: 'app/api/run/route.ts',
          kind: 'api-delegate',
          policy: 'delegate-to-runtime-service',
        }],
      })

      expect(report.passed).toBe(false)
      expect(report.unclassifiedCandidates).toEqual(['app/api/runtime-probe/route.ts'])
      expect(report.violations).toContainEqual({
        file: 'app/api/runtime-probe/route.ts',
        category: 'unclassified-lifecycle',
        pattern: 'api-runtime-service-reference',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('classified inline dynamic runtime-service reference stays a candidate but fails runtime-service proof', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threados-runtime-boundary-inline-runtime-service-reference-'))
    try {
      await writeFixtureFiles(root, {
        'app/api/run/route.ts': `
          export async function POST() {
            return (await import('@/lib/api/runtime-request')).getApiRuntimeService('fixture')
          }
        `,
      })

      const report = await scanRuntimeServiceBoundary(root, {
        classifications: [{
          file: 'app/api/run/route.ts',
          kind: 'api-delegate',
          policy: 'delegate-to-runtime-service',
        }],
      })

      expect(report.passed).toBe(false)
      expect(report.candidateFiles).toEqual(['app/api/run/route.ts'])
      expect(report.classifiedFiles).toEqual(['app/api/run/route.ts'])
      expect(report.unclassifiedCandidates).toEqual([])
      expect(report.violations).toContainEqual({
        file: 'app/api/run/route.ts',
        category: 'missing-runtime-service',
        pattern: 'api-runtime-service',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('backtick canonical runtime-service reference is a candidate without satisfying delegate proof', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threados-runtime-boundary-backtick-runtime-service-reference-'))
    try {
      await writeFixtureFiles(root, {
        'app/api/runtime-probe/route.ts': `
          export async function GET() {
            return (await import(\`@/lib/api/runtime-request\`)).getApiRuntimeService('fixture')
          }
        `,
      })

      const report = await scanRuntimeServiceBoundary(root, { classifications: [] })
      expect(report.passed).toBe(false)
      expect(report.candidateFiles).toEqual(['app/api/runtime-probe/route.ts'])
      expect(report.unclassifiedCandidates).toEqual(['app/api/runtime-probe/route.ts'])
      expect(report.violations).toContainEqual({
        file: 'app/api/runtime-probe/route.ts',
        category: 'unclassified-lifecycle',
        pattern: 'api-runtime-service-reference',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('comment-only runtime-service names do not satisfy API delegate classification', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threados-runtime-boundary-comment-evasion-'))
    try {
      await writeFixtureFiles(root, {
        'app/api/run/route.ts': `
          // import { getApiRuntimeService } from '@/lib/api/runtime-request'
          // await getApiRuntimeService('fixture')
          export async function POST() {
            return Response.json({ ok: true })
          }
        `,
      })

      const report = await scanRuntimeServiceBoundary(root, {
        classifications: [{
          file: 'app/api/run/route.ts',
          kind: 'api-delegate',
          policy: 'delegate-to-runtime-service',
        }],
      })

      expect(report.passed).toBe(false)
      expect(report.candidateFiles).toEqual([])
      expect(report.violations).toContainEqual({
        file: 'app/api/run/route.ts',
        category: 'missing-runtime-service',
        pattern: 'api-runtime-service',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('parameter shadowing prevents imported runtime factory proof', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threados-runtime-boundary-param-shadow-'))
    try {
      await writeFixtureFiles(root, {
        'app/api/run/route.ts': `
          import { getApiRuntimeService } from '@/lib/api/runtime-request'
          async function invoke(getApiRuntimeService: (value: string) => Promise<string>) {
            return getApiRuntimeService('shadowed')
          }
          export async function POST() {
            return invoke(async value => value)
          }
        `,
      })

      const report = await scanRuntimeServiceBoundary(root, {
        classifications: [{
          file: 'app/api/run/route.ts',
          kind: 'api-delegate',
          policy: 'delegate-to-runtime-service',
        }],
      })

      expect(report.passed).toBe(false)
      expect(report.violations).toContainEqual({
        file: 'app/api/run/route.ts',
        category: 'missing-runtime-service',
        pattern: 'api-runtime-service',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('nested local shadowing prevents imported runtime factory proof', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threados-runtime-boundary-local-shadow-'))
    try {
      await writeFixtureFiles(root, {
        'app/api/run/route.ts': `
          import { getApiRuntimeService } from '@/lib/api/runtime-request'
          function invoke() {
            const getApiRuntimeService = async (value: string) => value
            return getApiRuntimeService('shadowed')
          }
          export async function POST() {
            return invoke()
          }
        `,
      })

      const report = await scanRuntimeServiceBoundary(root, {
        classifications: [{
          file: 'app/api/run/route.ts',
          kind: 'api-delegate',
          policy: 'delegate-to-runtime-service',
        }],
      })

      expect(report.passed).toBe(false)
      expect(report.violations).toContainEqual({
        file: 'app/api/run/route.ts',
        category: 'missing-runtime-service',
        pattern: 'api-runtime-service',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('string-only ActionValidator names do not satisfy chat rejection classification', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threados-runtime-boundary-string-evasion-'))
    try {
      await writeFixtureFiles(root, {
        'app/api/apply/route.ts': `
          export async function POST() {
            const note = "ActionValidator"
            return Response.json({ note })
          }
        `,
      })

      const report = await scanRuntimeServiceBoundary(root, {
        classifications: [{
          file: 'app/api/apply/route.ts',
          kind: 'chat-runtime-controls-rejected',
          policy: 'reject-runtime-controls',
          requiredSignals: ['chat-action-validator'],
        }],
      })

      expect(report.passed).toBe(false)
      expect(report.candidateFiles).toEqual([])
      expect(report.violations).toContainEqual({
        file: 'app/api/apply/route.ts',
        category: 'missing-policy-signal',
        pattern: 'chat-action-validator',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('flags forbidden direct lifecycle calls outside the classification manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threados-runtime-boundary-forbidden-'))
    try {
      await writeFixtureFiles(root, {
        'lib/seqctl/commands/bad.ts': `
          import { startProcess } from '@/lib/runner/wrapper'
          export async function badCommand() {
            return startProcess({ command: 'bad' })
          }
        `,
      })

      const report = await scanRuntimeServiceBoundary(root, { classifications: [] })
      expect(report.passed).toBe(false)
      expect(report.violations).toEqual(expect.arrayContaining([
        {
          file: 'lib/seqctl/commands/bad.ts',
          category: 'forbidden-import',
          pattern: '(?:@\\/|\\.\\.\\/)+(?:lib\\/)?runner\\/(?:wrapper|dispatch|artifacts|prompt-compiler|process-handle)',
        },
        {
          file: 'lib/seqctl/commands/bad.ts',
          category: 'forbidden-lifecycle-call',
          pattern: '\\b(?:startProcess|runStep|executeStep|executeSingleStep)\\s*\\(',
        },
      ]))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('default forbidden runtime import is rejected', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threados-runtime-boundary-default-import-'))
    try {
      await writeFixtureFiles(root, {
        'app/api/run/route.ts': `
          import lifecycleDefault from '@/lib/runtime/lifecycle'
          export async function POST() {
            return lifecycleDefault
          }
        `,
      })

      const report = await scanRuntimeServiceBoundary(root, { classifications: [] })
      expect(report.passed).toBe(false)
      expect(report.candidateFiles).toEqual(['app/api/run/route.ts'])
      expect(report.violations).toContainEqual({
        file: 'app/api/run/route.ts',
        category: 'forbidden-import',
        pattern: '(?:@\\/|\\.\\.\\/)+(?:lib\\/)?runtime\\/(?:attempt-executor|process-controller|lifecycle|scheduler|factory|(?:run|attempt|process)-repository)',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('side-effect forbidden runtime import is rejected without a binding', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threados-runtime-boundary-side-effect-import-'))
    try {
      await writeFixtureFiles(root, {
        'app/api/run/route.ts': `
          import '@/lib/runtime/lifecycle'
          export async function POST() {
            return Response.json({ ok: true })
          }
        `,
      })

      const report = await scanRuntimeServiceBoundary(root, { classifications: [] })
      expect(report.passed).toBe(false)
      expect(report.candidateFiles).toEqual(['app/api/run/route.ts'])
      expect(report.violations).toContainEqual({
        file: 'app/api/run/route.ts',
        category: 'forbidden-import',
        pattern: '(?:@\\/|\\.\\.\\/)+(?:lib\\/)?runtime\\/(?:attempt-executor|process-controller|lifecycle|scheduler|factory|(?:run|attempt|process)-repository)',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('import equals forbidden runtime module is rejected', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threados-runtime-boundary-import-equals-'))
    try {
      await writeFixtureFiles(root, {
        'app/api/run/route.ts': `
          import runtimeLifecycle = require('@/lib/runtime/lifecycle')
          export async function POST() {
            return runtimeLifecycle.transitionRun({}, {}, 'running')
          }
        `,
      })

      const report = await scanRuntimeServiceBoundary(root, { classifications: [] })
      expect(report.passed).toBe(false)
      expect(report.violations).toEqual(expect.arrayContaining([
        {
          file: 'app/api/run/route.ts',
          category: 'forbidden-import',
          pattern: '(?:@\\/|\\.\\.\\/)+(?:lib\\/)?runtime\\/(?:attempt-executor|process-controller|lifecycle|scheduler|factory|(?:run|attempt|process)-repository)',
        },
        {
          file: 'app/api/run/route.ts',
          category: 'forbidden-lifecycle-call',
          pattern: '\\b(?:transitionRun|transitionAttempt|transitionProcess)\\s*\\(',
        },
      ]))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('unbound require property call is rejected', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threados-runtime-boundary-require-property-call-'))
    try {
      await writeFixtureFiles(root, {
        'app/api/run/route.ts': `
          export async function POST() {
            return require('@/lib/runtime/lifecycle').transitionRun({}, {}, 'running')
          }
        `,
      })

      const report = await scanRuntimeServiceBoundary(root, { classifications: [] })
      expect(report.passed).toBe(false)
      expect(report.violations).toEqual(expect.arrayContaining([
        {
          file: 'app/api/run/route.ts',
          category: 'forbidden-import',
          pattern: '(?:@\\/|\\.\\.\\/)+(?:lib\\/)?runtime\\/(?:attempt-executor|process-controller|lifecycle|scheduler|factory|(?:run|attempt|process)-repository)',
        },
        {
          file: 'app/api/run/route.ts',
          category: 'forbidden-lifecycle-call',
          pattern: '\\b(?:transitionRun|transitionAttempt|transitionProcess)\\s*\\(',
        },
      ]))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('backtick forbidden runtime module load is rejected', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threados-runtime-boundary-backtick-forbidden-import-'))
    try {
      await writeFixtureFiles(root, {
        'app/api/run/route.ts': `
          export async function POST() {
            return require(\`@/lib/runtime/lifecycle\`).transitionRun({}, {}, 'running')
          }
        `,
      })

      const report = await scanRuntimeServiceBoundary(root, { classifications: [] })
      expect(report.passed).toBe(false)
      expect(report.violations).toEqual(expect.arrayContaining([
        {
          file: 'app/api/run/route.ts',
          category: 'forbidden-import',
          pattern: '(?:@\\/|\\.\\.\\/)+(?:lib\\/)?runtime\\/(?:attempt-executor|process-controller|lifecycle|scheduler|factory|(?:run|attempt|process)-repository)',
        },
        {
          file: 'app/api/run/route.ts',
          category: 'forbidden-lifecycle-call',
          pattern: '\\b(?:transitionRun|transitionAttempt|transitionProcess)\\s*\\(',
        },
      ]))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('interpolated canonical runtime-service template fails closed as an unclassified candidate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threados-runtime-boundary-template-runtime-service-reference-'))
    try {
      await writeFixtureFiles(root, {
        'app/api/runtime-probe/route.ts': `
          const prefix = ''
          export async function GET() {
            return (await import(\`\${prefix}@/lib/api/runtime-request\`)).getApiRuntimeService('fixture')
          }
        `,
      })

      const report = await scanRuntimeServiceBoundary(root, { classifications: [] })
      expect(report.passed).toBe(false)
      expect(report.candidateFiles).toEqual(['app/api/runtime-probe/route.ts'])
      expect(report.unclassifiedCandidates).toEqual(['app/api/runtime-probe/route.ts'])
      expect(report.violations).toContainEqual({
        file: 'app/api/runtime-probe/route.ts',
        category: 'unclassified-lifecycle',
        pattern: 'api-runtime-service-reference',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('require-bound forbidden runtime module is rejected', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threados-runtime-boundary-require-import-'))
    try {
      await writeFixtureFiles(root, {
        'app/api/run/route.ts': `
          const runtimeLifecycle = require('@/lib/runtime/lifecycle')
          export async function POST() {
            return runtimeLifecycle.transitionRun({}, {}, 'running')
          }
        `,
      })

      const report = await scanRuntimeServiceBoundary(root, { classifications: [] })
      expect(report.passed).toBe(false)
      expect(report.violations).toEqual(expect.arrayContaining([
        {
          file: 'app/api/run/route.ts',
          category: 'forbidden-import',
          pattern: '(?:@\\/|\\.\\.\\/)+(?:lib\\/)?runtime\\/(?:attempt-executor|process-controller|lifecycle|scheduler|factory|(?:run|attempt|process)-repository)',
        },
        {
          file: 'app/api/run/route.ts',
          category: 'forbidden-lifecycle-call',
          pattern: '\\b(?:transitionRun|transitionAttempt|transitionProcess)\\s*\\(',
        },
      ]))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('nested dynamic import property call is rejected', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threados-runtime-boundary-nested-dynamic-import-'))
    try {
      await writeFixtureFiles(root, {
        'app/api/run/route.ts': `
          export async function POST() {
            return await (await import('@/lib/runtime/lifecycle')).transitionRun({}, {}, 'running')
          }
        `,
      })

      const report = await scanRuntimeServiceBoundary(root, { classifications: [] })
      expect(report.passed).toBe(false)
      expect(report.violations).toEqual(expect.arrayContaining([
        {
          file: 'app/api/run/route.ts',
          category: 'forbidden-import',
          pattern: '(?:@\\/|\\.\\.\\/)+(?:lib\\/)?runtime\\/(?:attempt-executor|process-controller|lifecycle|scheduler|factory|(?:run|attempt|process)-repository)',
        },
        {
          file: 'app/api/run/route.ts',
          category: 'forbidden-lifecycle-call',
          pattern: '\\b(?:transitionRun|transitionAttempt|transitionProcess)\\s*\\(',
        },
      ]))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('dynamic forbidden runtime module is rejected', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threados-runtime-boundary-dynamic-import-'))
    try {
      await writeFixtureFiles(root, {
        'app/api/run/route.ts': `
          export async function POST() {
            const runtimeLifecycle = await import('@/lib/runtime/lifecycle')
            return runtimeLifecycle.transitionRun({}, {}, 'running')
          }
        `,
      })

      const report = await scanRuntimeServiceBoundary(root, { classifications: [] })
      expect(report.passed).toBe(false)
      expect(report.violations).toEqual(expect.arrayContaining([
        {
          file: 'app/api/run/route.ts',
          category: 'forbidden-import',
          pattern: '(?:@\\/|\\.\\.\\/)+(?:lib\\/)?runtime\\/(?:attempt-executor|process-controller|lifecycle|scheduler|factory|(?:run|attempt|process)-repository)',
        },
        {
          file: 'app/api/run/route.ts',
          category: 'forbidden-lifecycle-call',
          pattern: '\\b(?:transitionRun|transitionAttempt|transitionProcess)\\s*\\(',
        },
      ]))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('same-named local executeStep helper is allowed when delegation is canonical', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threados-runtime-boundary-local-helper-'))
    try {
      await writeFixtureFiles(root, {
        'app/api/run/route.ts': `
          import { getApiRuntimeService } from '@/lib/api/runtime-request'
          async function executeStep() {
            return 'local-helper'
          }
          export async function POST() {
            await executeStep()
            return getApiRuntimeService('fixture')
          }
        `,
      })

      const report = await scanRuntimeServiceBoundary(root, {
        classifications: [{
          file: 'app/api/run/route.ts',
          kind: 'api-delegate',
          policy: 'delegate-to-runtime-service',
        }],
      })

      expect(report).toMatchObject({
        passed: true,
        violations: [],
        unclassifiedCandidates: [],
        missingClassifiedFiles: [],
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('namespace canonical runtime factory call is valid delegation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threados-runtime-boundary-namespace-factory-'))
    try {
      await writeFixtureFiles(root, {
        'app/api/run/route.ts': `
          import * as runtimeRequest from '@/lib/api/runtime-request'
          export async function POST() {
            return runtimeRequest.getApiRuntimeService('fixture')
          }
        `,
      })

      const report = await scanRuntimeServiceBoundary(root, {
        classifications: [{
          file: 'app/api/run/route.ts',
          kind: 'api-delegate',
          policy: 'delegate-to-runtime-service',
        }],
      })

      expect(report).toMatchObject({
        passed: true,
        violations: [],
        unclassifiedCandidates: [],
        missingClassifiedFiles: [],
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('aliased forbidden runtime import is rejected by origin-aware call analysis', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threados-runtime-boundary-aliased-import-'))
    try {
      await writeFixtureFiles(root, {
        'app/api/run/route.ts': `
          import { getApiRuntimeService } from '@/lib/api/runtime-request'
          import { runStep as runAttempt } from '@/lib/runtime/attempt-executor'
          export async function POST() {
            await runAttempt({ stepId: 'step-a' })
            return getApiRuntimeService('fixture')
          }
        `,
      })

      const report = await scanRuntimeServiceBoundary(root, {
        classifications: [{
          file: 'app/api/run/route.ts',
          kind: 'api-delegate',
          policy: 'delegate-to-runtime-service',
        }],
      })

      expect(report.passed).toBe(false)
      expect(report.violations).toEqual(expect.arrayContaining([
        {
          file: 'app/api/run/route.ts',
          category: 'forbidden-import',
          pattern: '(?:@\\/|\\.\\.\\/)+(?:lib\\/)?runtime\\/(?:attempt-executor|process-controller|lifecycle|scheduler|factory|(?:run|attempt|process)-repository)',
        },
        {
          file: 'app/api/run/route.ts',
          category: 'forbidden-lifecycle-call',
          pattern: '\\b(?:startProcess|runStep|executeStep|executeSingleStep)\\s*\\(',
        },
      ]))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('namespace forbidden runtime call is rejected by origin-aware analysis', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threados-runtime-boundary-namespace-call-'))
    try {
      await writeFixtureFiles(root, {
        'app/api/run/route.ts': `
          import { getApiRuntimeService } from '@/lib/api/runtime-request'
          import * as runtimeLifecycle from '@/lib/runtime/lifecycle'
          export async function POST() {
            await runtimeLifecycle.transitionRun({}, {}, 'running')
            return getApiRuntimeService('fixture')
          }
        `,
      })

      const report = await scanRuntimeServiceBoundary(root, {
        classifications: [{
          file: 'app/api/run/route.ts',
          kind: 'api-delegate',
          policy: 'delegate-to-runtime-service',
        }],
      })

      expect(report.passed).toBe(false)
      expect(report.violations).toEqual(expect.arrayContaining([
        {
          file: 'app/api/run/route.ts',
          category: 'forbidden-import',
          pattern: '(?:@\\/|\\.\\.\\/)+(?:lib\\/)?runtime\\/(?:attempt-executor|process-controller|lifecycle|scheduler|factory|(?:run|attempt|process)-repository)',
        },
        {
          file: 'app/api/run/route.ts',
          category: 'forbidden-lifecycle-call',
          pattern: '\\b(?:transitionRun|transitionAttempt|transitionProcess)\\s*\\(',
        },
      ]))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('reports missing classified interfaces explicitly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threados-runtime-boundary-missing-'))
    try {
      await writeFixtureFiles(root, {
        'app/api/run/route.ts': `
          import { getApiRuntimeService } from '@/lib/api/runtime-request'
          export async function POST() {
            return getApiRuntimeService('fixture')
          }
        `,
      })

      const report = await scanRuntimeServiceBoundary(root, {
        classifications: [
          {
            file: 'app/api/run/route.ts',
            kind: 'api-delegate',
            policy: 'delegate-to-runtime-service',
          },
          {
            file: 'app/api/runs/route.ts',
            kind: 'api-delegate',
            policy: 'delegate-to-runtime-service',
          },
        ],
      })

      expect(report.passed).toBe(false)
      expect(report.missingClassifiedFiles).toEqual(['app/api/runs/route.ts'])
      expect(report.violations).toContainEqual({
        file: 'app/api/runs/route.ts',
        category: 'missing-classified-interface',
        pattern: 'classified-file-missing',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('accepts valid API and CLI delegates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threados-runtime-boundary-valid-'))
    try {
      await writeFixtureFiles(root, {
        'app/api/run/route.ts': `
          import { getApiRuntimeService as getRuntime } from '@/lib/api/runtime-request'
          export async function POST() {
            const service = await getRuntime('fixture')
            return service
          }
        `,
        'lib/seqctl/commands/run.ts': `
          import { getCLIRuntimeService as getRuntime } from '../runtime'
          export async function runCommand() {
            return getRuntime(process.cwd())
          }
        `,
      })

      const report = await scanRuntimeServiceBoundary(root, {
        classifications: [
          {
            file: 'app/api/run/route.ts',
            kind: 'api-delegate',
            policy: 'delegate-to-runtime-service',
          },
          {
            file: 'lib/seqctl/commands/run.ts',
            kind: 'cli-delegate',
            policy: 'delegate-to-runtime-service',
          },
        ],
      })

      expect(report).toMatchObject({
        passed: true,
        unclassifiedCandidates: [],
        missingClassifiedFiles: [],
        violations: [],
      })
      expect(report.classifiedFiles).toEqual([
        'app/api/run/route.ts',
        'lib/seqctl/commands/run.ts',
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('reports missing root traversal errors and fails closed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threados-runtime-boundary-missing-root-'))
    try {
      await writeFixtureFiles(root, {
        'app/api/run/route.ts': `
          import { getApiRuntimeService } from '@/lib/api/runtime-request'
          export async function POST() {
            return getApiRuntimeService('fixture')
          }
        `,
      })

      const report = await scanRuntimeServiceBoundary(root, {
        roots: ['app/api', 'lib/seqctl/commands', 'missing/root'],
      })

      expect(report.passed).toBe(false)
      expect(report.traversalErrors).toEqual([
        { path: 'missing/root', code: 'ENOENT' },
      ])
      expect(report.violations).toContainEqual({
        file: 'missing/root',
        category: 'interface-traversal-error',
        pattern: 'ENOENT',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('reports injected read failures and fails closed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threados-runtime-boundary-read-error-'))
    try {
      await writeFixtureFiles(root, {
        'app/api/run/route.ts': `
          import { getApiRuntimeService } from '@/lib/api/runtime-request'
          export async function POST() {
            return getApiRuntimeService('fixture')
          }
        `,
      })

      const filesystem: RuntimeLifecycleFileSystem = {
        readdir: async (path, options) => import('fs/promises').then(fs => fs.readdir(path, options)),
        readFile: async (path, encoding) => {
          if (String(path).replaceAll('\\', '/').endsWith('app/api/run/route.ts')) {
            const error = new Error('simulated read failure')
            Object.assign(error, { code: 'SIMULATED_READ_ERROR' })
            throw error
          }
          return import('fs/promises').then(fs => fs.readFile(path, encoding))
        },
      }

      const report = await scanRuntimeServiceBoundary(root, { filesystem })
      expect(report.passed).toBe(false)
      expect(report.traversalErrors).toContainEqual({
        path: 'app/api/run/route.ts',
        code: 'SIMULATED_READ_ERROR',
      })
      expect(report.violations).toContainEqual({
        file: 'app/api/run/route.ts',
        category: 'interface-traversal-error',
        pattern: 'SIMULATED_READ_ERROR',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('delegate candidates fail when they own gates approvals or thread-surface lifecycle work', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threados-runtime-boundary-delegate-ownership-'))
    try {
      await writeFixtureFiles(root, {
        'app/api/run/route.ts': `
          import { getApiRuntimeService } from '@/lib/api/runtime-request'
          import { evaluatePreGates } from '@/lib/gates/engine'
          import { readApprovals } from '@/lib/approvals/repository'
          import { beginStepRunIfSurfaceExists } from '@/lib/thread-surfaces/step-run-runtime'
          import { writeThreadSurfaceState } from '@/lib/thread-surfaces/repository'
          export async function POST() {
            const service = await getApiRuntimeService('fixture')
            await evaluatePreGates()
            await readApprovals('fixture', 'run-1')
            beginStepRunIfSurfaceExists({}, {}, {})
            await writeThreadSurfaceState('fixture', {})
            return service
          }
        `,
      })

      const report = await scanRuntimeServiceBoundary(root, {
        classifications: [{
          file: 'app/api/run/route.ts',
          kind: 'api-delegate',
          policy: 'delegate-to-runtime-service',
        }],
      })

      expect(report.passed).toBe(false)
      expect(report.violations).toEqual(expect.arrayContaining([
        {
          file: 'app/api/run/route.ts',
          category: 'forbidden-import',
          pattern: '(?:@\\/|\\.\\.\\/)+(?:lib\\/)?gates\\/(?:engine|rules)',
        },
        {
          file: 'app/api/run/route.ts',
          category: 'forbidden-import',
          pattern: '(?:@\\/|\\.\\.\\/)+(?:lib\\/)?approvals\\/(?:binding|runtime|repository)',
        },
        {
          file: 'app/api/run/route.ts',
          category: 'forbidden-import',
          pattern: '(?:@\\/|\\.\\.\\/)+(?:lib\\/)?thread-surfaces\\/(?:mutations|step-run-runtime|materializer)',
        },
        {
          file: 'app/api/run/route.ts',
          category: 'forbidden-lifecycle-call',
          pattern: 'writeThreadSurfaceState',
        },
      ]))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('keeps the current chat/apply rejection boundary classified and direct-lifecycle free', async () => {
    const report = await scanRuntimeServiceBoundary(process.cwd())
    const chatBoundaryFiles = [
      'app/api/apply/route.ts',
      'app/api/chat/route.ts',
      'lib/chat/commands.ts',
      'lib/chat/validator.ts',
    ]

    expect(RUNTIME_LIFECYCLE_INTERFACE_CLASSIFICATIONS
      .filter(entry => entry.kind === 'chat-runtime-controls-rejected')
      .map(entry => entry.file)
      .sort()).toEqual(chatBoundaryFiles)
    expect(report.candidateFiles).toEqual(expect.arrayContaining(chatBoundaryFiles))
    expect(report.classifiedFiles).toEqual(expect.arrayContaining(chatBoundaryFiles))
    expect(report.violations.filter(violation => chatBoundaryFiles.includes(violation.file))).toEqual([])
  })
})

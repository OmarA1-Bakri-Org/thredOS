import { resolve } from 'path'

const repositoryRoot = resolve(import.meta.dir, '..', '..')
const excludedPrefixes = [
  '.git/',
  '.next/',
  '.omx/',
  '.token-optimizer/',
  '.worktrees/',
  'node_modules/',
  'test-results/',
]
const patterns = [
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.test.js',
  '**/*.test.jsx',
  '**/*.test.cjs',
]
const discovered = new Set<string>()

for (const pattern of patterns) {
  const glob = new Bun.Glob(pattern)
  for await (const path of glob.scan({ cwd: repositoryRoot, onlyFiles: true })) {
    const portable = path.replaceAll('\\', '/')
    if (excludedPrefixes.some(prefix => portable.startsWith(prefix))) continue
    discovered.add(portable)
  }
}

const files = [...discovered].sort((left, right) => Buffer.compare(
  Buffer.from(left, 'utf8'),
  Buffer.from(right, 'utf8'),
))
// Several legacy tests use process-global module mocks, environment mutation,
// and fault-injection hooks. One exact file per process is the only truthful
// isolation boundary until those tests are migrated to scoped harnesses.
const batchSize = 1
const startBatch = Number.parseInt(process.env.CHECK_TEST_START_BATCH ?? '1', 10)
const fileTimeoutMs = Number.parseInt(process.env.CHECK_TEST_FILE_TIMEOUT_MS ?? '180000', 10)
const testTimeoutMs = Number.parseInt(process.env.CHECK_TEST_CASE_TIMEOUT_MS ?? '30000', 10)
if (files.length === 0) throw new Error('No repository test files were discovered')
if (!Number.isSafeInteger(startBatch) || startBatch < 1) {
  throw new Error('CHECK_TEST_START_BATCH must be a positive integer')
}
if (!Number.isSafeInteger(fileTimeoutMs) || fileTimeoutMs < 10_000) {
  throw new Error('CHECK_TEST_FILE_TIMEOUT_MS must be an integer of at least 10000')
}
if (!Number.isSafeInteger(testTimeoutMs) || testTimeoutMs < 5_000 || testTimeoutMs >= fileTimeoutMs) {
  throw new Error('CHECK_TEST_CASE_TIMEOUT_MS must be at least 5000 and below the file timeout')
}

async function runExactFile(batch: string[], timeoutMs: number): Promise<{ exitCode: number; timedOut: boolean }> {
  const child = Bun.spawn([
    process.execPath,
    'test',
    '--max-concurrency=1',
    `--timeout=${testTimeoutMs}`,
    ...batch,
  ], {
    cwd: repositoryRoot,
    env: process.env,
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
    windowsHide: true,
  })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill()
  }, timeoutMs)
  try {
    return { exitCode: await child.exited, timedOut }
  } finally {
    clearTimeout(timer)
  }
}

for (let offset = (startBatch - 1) * batchSize; offset < files.length; offset += batchSize) {
  const batch = files.slice(offset, offset + batchSize)
  const batchNumber = Math.floor(offset / batchSize) + 1
  const batchCount = Math.ceil(files.length / batchSize)
  // This legacy route coverage file contains sixteen serial API cases. On
  // Windows, the complete file can exceed the ordinary per-file watchdog even
  // while its individual cases are making progress and passing.
  const batchTimeoutMs = batch[0] === 'test/api/run-route-coverage.test.ts'
    ? Math.max(fileTimeoutMs, 360_000)
    : fileTimeoutMs
  console.log(`CHECK_TEST_BATCH=${batchNumber}/${batchCount} FILES=${batch.length}`)
  let result = await runExactFile(batch, batchTimeoutMs)
  if (result.timedOut) {
    console.warn(`CHECK_TEST_TIMEOUT_RETRY=${batchNumber}/${batchCount} TIMEOUT_MS=${batchTimeoutMs}`)
    result = await runExactFile(batch, batchTimeoutMs)
  }
  if (result.timedOut) {
    console.error(`CHECK_TEST_TIMEOUT=${batchNumber}/${batchCount} TIMEOUT_MS=${batchTimeoutMs}`)
    process.exit(124)
  }
  if (result.exitCode !== 0) process.exit(result.exitCode)
  if (process.platform === 'win32') {
    await new Promise(resolve => setTimeout(resolve, batchNumber % 25 === 0 ? 250 : 25))
  }
}

console.log(`CHECK_TEST_FILES=${files.length} STATUS=PASS`)

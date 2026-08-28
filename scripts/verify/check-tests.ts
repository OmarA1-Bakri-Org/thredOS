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
if (files.length === 0) throw new Error('No repository test files were discovered')
if (!Number.isSafeInteger(startBatch) || startBatch < 1) {
  throw new Error('CHECK_TEST_START_BATCH must be a positive integer')
}

for (let offset = (startBatch - 1) * batchSize; offset < files.length; offset += batchSize) {
  const batch = files.slice(offset, offset + batchSize)
  const batchNumber = Math.floor(offset / batchSize) + 1
  const batchCount = Math.ceil(files.length / batchSize)
  console.log(`CHECK_TEST_BATCH=${batchNumber}/${batchCount} FILES=${batch.length}`)
  const child = Bun.spawn([
    process.execPath,
    'test',
    '--max-concurrency=1',
    ...batch,
  ], {
    cwd: repositoryRoot,
    env: process.env,
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await child.exited
  if (exitCode !== 0) process.exit(exitCode)
}

console.log(`CHECK_TEST_FILES=${files.length} STATUS=PASS`)

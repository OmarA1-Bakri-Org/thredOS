import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { accessSync, chmodSync, constants, copyFileSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, isAbsolute, join, resolve } from 'node:path'

const fixturePath = resolve(process.cwd(), 'scripts/verify/fixtures/claude')
const fixtureHash = '8488995d681bd5cead5b454cc4acaec8d30156978c78dbb1e4085cf39b349523'
const fixtureVariable = 'THREDOS_VERIFY_CLI_FIXTURE_DIR'

function hashFile(path: string) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function firstExecutable(name: string, env: NodeJS.ProcessEnv) {
  for (const directory of (env.PATH ?? '').split(delimiter)) {
    const candidate = join(directory || '.', name)
    try {
      accessSync(candidate, constants.X_OK)
      if (lstatSync(candidate).isFile() || lstatSync(candidate).isSymbolicLink()) return realpathSync(candidate)
    } catch { /* Continue exactly as PATH lookup does. */ }
  }
  return null
}

/** Fails before registration or dispatch unless the owned, fixed-output Linux CLI is selected. */
export function assertVerificationCliFixture(env: NodeJS.ProcessEnv = process.env) {
  if (process.platform !== 'linux') throw new Error('The local verification CLI fixture currently supports Linux only; no real CLI fallback is permitted')
  const directory = env[fixtureVariable]
  if (!directory || !isAbsolute(directory)) {
    throw new Error('Run this case through node scripts/verify/cli-fixture.ts <Node verification arguments>; a local CLI fixture is required')
  }
  const root = lstatSync(directory)
  if (!root.isDirectory() || root.isSymbolicLink() || realpathSync(directory) !== resolve(directory)
    || (root.mode & 0o077) !== 0 || root.uid !== process.getuid?.()) {
    throw new Error('The verification CLI fixture directory is not private and owned')
  }
  const executable = join(directory, 'claude')
  const file = lstatSync(executable)
  if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1 || (file.mode & 0o022) !== 0
    || hashFile(executable) !== fixtureHash || firstExecutable('claude', env) !== executable) {
    throw new Error('The verification CLI fixture hash or PATH binding is invalid; no real CLI fallback is permitted')
  }
}

/** Creates only a temporary executable directory; application policy and provider code stay unchanged. */
export function prepareVerificationCliFixture(env: NodeJS.ProcessEnv = process.env) {
  if (process.platform !== 'linux') throw new Error('The local verification CLI fixture currently supports Linux only')
  if (hashFile(fixturePath) !== fixtureHash) throw new Error('The versioned verification CLI fixture hash changed')
  const directory = mkdtempSync(join(tmpdir(), 'thredos-verify-cli-'))
  try {
    copyFileSync(fixturePath, join(directory, 'claude'), constants.COPYFILE_EXCL)
    chmodSync(join(directory, 'claude'), 0o700)
    const fixtureEnv = { ...env, [fixtureVariable]: directory, PATH: `${directory}${delimiter}${env.PATH ?? ''}` }
    assertVerificationCliFixture(fixtureEnv)
    return { env: fixtureEnv, cleanup: () => rmSync(directory, { recursive: true }) }
  } catch (error) {
    rmSync(directory, { recursive: true })
    throw error
  }
}

// Example: node scripts/verify/cli-fixture.ts scripts/verify/run.mjs ci --grep 'records SAFE runtime'
if (process.argv[1] && resolve(process.argv[1]) === resolve(process.cwd(), 'scripts/verify/cli-fixture.ts')) {
  let fixture: ReturnType<typeof prepareVerificationCliFixture> | undefined
  try {
    if (process.argv.length < 3) throw new Error('Provide the Node verification script and its arguments')
    fixture = prepareVerificationCliFixture()
    const result = spawnSync(process.execPath, process.argv.slice(2), { env: fixture.env, stdio: 'inherit', shell: false })
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  } finally {
    fixture?.cleanup()
  }
}

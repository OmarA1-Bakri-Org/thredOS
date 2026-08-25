import { afterEach, describe, expect, test } from 'bun:test'
import { createServer, type Server } from 'net'
import { readFile } from 'fs/promises'
import {
  buildRelayVerificationArgs,
  createPlaywrightServerSettings,
  defaultVerificationPort,
  findBunPath,
  prependPath,
  releasePortReservation,
  reserveVerificationPort,
} from './runtime-helpers.mjs'

const openServers: Server[] = []
const TEST_ENV = { NODE_ENV: 'test' as const }

async function bind(port: number): Promise<Server> {
  const server = createServer()
  openServers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port }, resolve)
  })
  return server
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map(server => new Promise<void>((resolve) => {
    if (!server.listening) return resolve()
    server.close(() => resolve())
  })))
})

describe('findBunPath', () => {
  test('prefers a valid explicit BUN_BIN', () => {
    expect(findBunPath({
      env: { ...TEST_ENV, BUN_BIN: 'C:\\tools\\bun.exe' },
      platform: 'win32',
      exists: candidate => candidate === 'C:\\tools\\bun.exe',
      lookup: () => [],
    })).toBe('C:\\tools\\bun.exe')
  })

  test('resolves BUN_INSTALL before home candidates', () => {
    expect(findBunPath({
      env: { ...TEST_ENV, BUN_INSTALL: 'D:\\bun-home', USERPROFILE: 'C:\\Users\\test' },
      platform: 'win32',
      exists: candidate => candidate === 'D:\\bun-home\\bin\\bun.exe',
      lookup: () => [],
    })).toBe('D:\\bun-home\\bin\\bun.exe')
  })

  test('resolves the Windows USERPROFILE bun.exe candidate', () => {
    expect(findBunPath({
      env: { ...TEST_ENV, USERPROFILE: 'C:\\Users\\test' },
      platform: 'win32',
      exists: candidate => candidate === 'C:\\Users\\test\\.bun\\bin\\bun.exe',
      lookup: () => [],
    })).toBe('C:\\Users\\test\\.bun\\bin\\bun.exe')
  })

  test('uses the first valid Windows where.exe result', () => {
    expect(findBunPath({
      env: { ...TEST_ENV },
      platform: 'win32',
      exists: candidate => candidate === 'D:\\bin\\bun.exe',
      lookup: () => ['C:\\stale\\bun.exe', 'D:\\bin\\bun.exe'],
    })).toBe('D:\\bin\\bun.exe')
  })

  test('resolves POSIX HOME and command lookup candidates', () => {
    expect(findBunPath({
      env: { ...TEST_ENV, HOME: '/home/test' },
      platform: 'linux',
      exists: candidate => candidate === '/home/test/.bun/bin/bun',
      lookup: () => [],
    })).toBe('/home/test/.bun/bin/bun')

    expect(findBunPath({
      env: { ...TEST_ENV },
      platform: 'linux',
      exists: candidate => candidate === '/opt/bun/bin/bun',
      lookup: () => ['/opt/bun/bin/bun'],
    })).toBe('/opt/bun/bin/bun')
  })
})

describe('prependPath', () => {
  test('uses the platform delimiter and preserves original path segments and casing', () => {
    expect(prependPath('C:\\Bun\\bin', 'C:\\Windows;D:\\Tools', 'win32'))
      .toBe('C:\\Bun\\bin;C:\\Windows;D:\\Tools')
    expect(prependPath('/opt/bun/bin', '/usr/local/bin:/usr/bin', 'linux'))
      .toBe('/opt/bun/bin:/usr/local/bin:/usr/bin')
  })

  test('does not synthesize undefined path segments', () => {
    expect(prependPath(undefined, 'C:\\Windows', 'win32')).toBe('C:\\Windows')
    expect(prependPath('/opt/bun/bin', undefined, 'linux')).toBe('/opt/bun/bin')
  })
})

describe('native verification relay arguments', () => {
  test('preserves forwarded Playwright arguments', () => {
    expect(buildRelayVerificationArgs('ui', ['--update-snapshots', '--grep', 'workbench']))
      .toEqual([
        'scripts/verify/run.mjs',
        'ui',
        '--update-snapshots',
        '--grep',
        'workbench',
      ])
  })
})

describe('verification port lifecycle', () => {
  test('releases a claimed probe port before Playwright starts', async () => {
    const allocation = await reserveVerificationPort('local', '0')
    expect(allocation.reservation).not.toBeNull()
    expect(allocation.port).toBeGreaterThan(0)

    await releasePortReservation(allocation.reservation)
    const rebound = await bind(allocation.port!)
    expect(rebound.listening).toBe(true)
  })

  test('leaves release-live external and unreserved', async () => {
    const allocation = await reserveVerificationPort('release-live')
    expect(allocation).toEqual({ port: null, reservation: null })
  })

  test('assigns direct UI verification its own stable port', () => {
    expect(defaultVerificationPort('ui')).toBe(4303)
  })
})

describe('shared Playwright server settings', () => {
  test('uses one CI port decision and 127.0.0.1 on Windows and POSIX', () => {
    expect(defaultVerificationPort('ci')).toBe(4302)
    const windows = createPlaywrightServerSettings({
      mode: 'ci',
      platform: 'win32',
      env: { ...TEST_ENV, Path: 'C:\\Windows', BUN_INSTALL: 'C:\\Users\\test\\.bun' },
    })
    expect(windows.port).toBe('4302')
    expect(windows.baseURL).toBe('http://127.0.0.1:4302')
    expect(windows.env.Path).toBe('C:\\Users\\test\\.bun\\bin;C:\\Windows')
    expect(windows.env.PATH).toBeUndefined()

    const posix = createPlaywrightServerSettings({
      mode: 'local',
      platform: 'linux',
      env: { ...TEST_ENV, PATH: '/usr/bin', BUN_INSTALL: '/home/test/.bun' },
    })
    expect(posix.port).toBe('4301')
    expect(posix.baseURL).toBe('http://127.0.0.1:4301')
    expect(posix.env.PATH).toBe('/home/test/.bun/bin:/usr/bin')
  })

  test('honors one explicit server port and base URL decision', () => {
    const settings = createPlaywrightServerSettings({
      mode: 'ci',
      platform: 'win32',
      env: { ...TEST_ENV, PLAYWRIGHT_PORT: '4510', PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:4510' },
    })
    expect(settings.port).toBe('4510')
    expect(settings.baseURL).toBe('http://127.0.0.1:4510')
  })

  test('direct UI configuration includes its requested test and process.execPath launches Next', async () => {
    const [packageBody, configBody, devConfigBody, uiConfigBody, devBody, buildBody, serverBody, globalSetupBody] = await Promise.all([
      readFile('package.json', 'utf8'),
      readFile('playwright.config.ts', 'utf8'),
      readFile('playwright.dev-verify.config.ts', 'utf8'),
      readFile('playwright.ui.config.ts', 'utf8'),
      readFile('scripts/dev/next-dev.mjs', 'utf8'),
      readFile('scripts/build/next-build.mjs', 'utf8'),
      readFile('scripts/verify/web-server.mjs', 'utf8'),
      readFile('test/ui/global-verify-setup.ts', 'utf8'),
    ])
    expect(JSON.parse(packageBody).scripts['test:ui']).toContain('scripts/verify/run.mjs ui')
    expect(uiConfigBody).toContain('main-page.e2e.ts')
    expect(configBody).toContain('main-page.e2e.ts')
    expect(configBody).toContain('process.execPath')
    expect(devConfigBody).toContain('process.execPath')
    expect(devBody).toContain('spawn(process.execPath')
    expect(buildBody).toContain("run(process.execPath, ['./node_modules/next/dist/bin/next', 'build']")
    expect(serverBody).toContain('defaultVerificationPort(mode)')
    expect(globalSetupBody).toContain('config.projects[0]?.use.baseURL')
  })
})

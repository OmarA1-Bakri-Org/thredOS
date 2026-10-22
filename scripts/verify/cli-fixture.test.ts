import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertVerificationCliFixture, prepareVerificationCliFixture } from './cli-fixture'

describe.skipIf(process.platform !== 'linux')('Linux-only fixed local verification CLI', () => {
  test('rejects an absent fixture before any executable is invoked', () => {
    expect(() => assertVerificationCliFixture({ ...process.env, THREDOS_VERIFY_CLI_FIXTURE_DIR: undefined }))
      .toThrow('a local CLI fixture is required')
  })

  test('executes only fixed output and never evaluates prompt arguments', () => {
    const fixture = prepareVerificationCliFixture()
    try {
      assertVerificationCliFixture(fixture.env)
      const directory = fixture.env.THREDOS_VERIFY_CLI_FIXTURE_DIR
      const marker = join(directory, 'must-not-exist')
      const output = execFileSync(join(directory, 'claude'), ['-p', `$(touch ${marker})`, '--output-format', 'json'], {
        env: fixture.env, encoding: 'utf8', shell: false,
      })
      expect(JSON.parse(output)).toEqual({ type: 'result', subtype: 'success', is_error: false,
        result: 'THREADOS_VERIFICATION_LOCAL_CLI_V1' })
      expect(existsSync(marker)).toBe(false)
    } finally {
      fixture.cleanup()
    }
  })

  test('rejects tampered fixture bytes despite the correct environment marker', () => {
    const fixture = prepareVerificationCliFixture()
    try {
      writeFileSync(join(fixture.env.THREDOS_VERIFY_CLI_FIXTURE_DIR, 'claude'), '#!/bin/sh\nexit 0\n')
      expect(() => assertVerificationCliFixture(fixture.env)).toThrow('hash or PATH binding is invalid')
    } finally {
      fixture.cleanup()
    }
  })

  test('rejects another executable earlier on PATH without invoking it', () => {
    const fixture = prepareVerificationCliFixture()
    try {
      const directory = fixture.env.THREDOS_VERIFY_CLI_FIXTURE_DIR
      const shadow = mkdtempSync(join(directory, 'shadow-'))
      const marker = join(shadow, 'must-not-exist')
      writeFileSync(join(shadow, 'claude'), `#!/bin/sh\ntouch '${marker}'\n`)
      chmodSync(join(shadow, 'claude'), 0o700)
      expect(() => assertVerificationCliFixture({ ...fixture.env, PATH: `${shadow}:${fixture.env.PATH}` }))
        .toThrow('hash or PATH binding is invalid')
      expect(existsSync(marker)).toBe(false)
    } finally {
      fixture.cleanup()
    }
  })

  test('rejects a symlink substituted for the verified regular fixture', () => {
    const fixture = prepareVerificationCliFixture()
    try {
      const directory = fixture.env.THREDOS_VERIFY_CLI_FIXTURE_DIR
      const executable = join(directory, 'claude')
      unlinkSync(executable)
      symlinkSync(process.execPath, executable)
      expect(() => assertVerificationCliFixture(fixture.env)).toThrow('hash or PATH binding is invalid')
    } finally {
      fixture.cleanup()
    }
  })
})

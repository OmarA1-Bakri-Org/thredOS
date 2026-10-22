import { strict as assert } from 'node:assert'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'bun:test'
import { classifyWindowsHelperRecovery, runWindowsApplyHelper } from './windows-helper-client'
import type { WindowsHelperRequest } from './windows-helper-types'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'threados-helper-'))
  roots.push(base)
  const root = join(base, 'canonical')
  const journalDir = join(base, 'journal')
  await mkdir(root)
  await mkdir(journalDir)
  await writeFile(join(base, 'outside-sentinel'), 'untouched')
  const digest = `sha256:${'a'.repeat(64)}`
  const request: WindowsHelperRequest = {
    schema_version: 1, operation_id: 'test-one', root, expected_root_id: 'a'.repeat(48),
    source: 'stage.txt', expected_source_id: 'b'.repeat(48), destination: 'target.txt',
    expected_destination_parent_id: 'a'.repeat(48), kind: 'rename', plan_id: 'plan-one',
    plan_hash: digest, preview_hash: digest, approval_hash: digest, root_hash: digest,
  }
  return { base, root, journalDir, request }
}

test('rejects invalid request before spawning or writing launch journal', async () => {
  const { journalDir, request } = await fixture()
  await assert.rejects(runWindowsApplyHelper({ request: { ...request, operation_id: '../bad' }, journalDir,
    helperPath: join(journalDir, 'missing.cjs'), executablePath: process.execPath, timeoutMs: 1000 }))
  assert.equal((await readdir(journalDir)).length, 0)
})

test('rejects oversized fields and multibyte serialized input before journal or spawn', async () => {
  const { base, journalDir, request } = await fixture()
  const helperPath = join(base, 'unused.cjs')
  await writeFile(helperPath, '')
  const run = (candidate: WindowsHelperRequest) => runWindowsApplyHelper({ request: candidate,
    journalDir, helperPath, executablePath: process.execPath, timeoutMs: 1000 })
  await assert.rejects(run({ ...request, plan_id: 'p'.repeat(257) }))
  await assert.rejects(run({ ...request, root: `${request.root}${'é'.repeat(3990)}`,
    source: Array(20).fill('é'.repeat(190)).join('/'), destination: Array(20).fill('é'.repeat(190)).join('/') }), /MERGE_HELPER_REQUEST_TOO_LARGE/)
  assert.equal((await readdir(journalDir)).length, 0)
})

test('failed spawn retains a review-required launch record and outside sentinel', async () => {
  const { base, journalDir, request } = await fixture()
  const helperPath = join(base, 'helper.cjs')
  await writeFile(helperPath, '')
  const result = await runWindowsApplyHelper({ request, journalDir,
    helperPath, executablePath: join(base, 'missing-node.exe'), timeoutMs: 2000 })
  assert.equal(result.status, 'failed')
  const recovered = await classifyWindowsHelperRecovery(result.journalPath)
  assert.equal(recovered.status, 'requires-review')
  assert.equal(recovered.journalClaim, 'mutation-uncertain')
  assert.equal(await readFile(join(base, 'outside-sentinel'), 'utf8'), 'untouched')
})

test('crash after started journal is indeterminate, including on restart', async () => {
  const { base, journalDir, request } = await fixture()
  const helperPath = join(base, 'crash.cjs')
  await writeFile(helperPath, `const fs=require('node:fs');const p=process.argv[2];let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{let j=JSON.parse(fs.readFileSync(p));j.phase='started';j.updated_at=new Date().toISOString();fs.writeFileSync(p,JSON.stringify(j));process.exit(71)})`)
  const result = await runWindowsApplyHelper({ request, journalDir, helperPath,
    executablePath: process.execPath, timeoutMs: 2000 })
  assert.equal(result.status, 'indeterminate')
  assert.equal((await classifyWindowsHelperRecovery(result.journalPath)).status, 'requires-review')
  await assert.rejects(runWindowsApplyHelper({ request, journalDir, helperPath,
    executablePath: process.execPath, timeoutMs: 1000 }), { code: 'EEXIST' })
  assert.equal(await readFile(join(base, 'outside-sentinel'), 'utf8'), 'untouched')
})

test('timeout after started journal is indeterminate', async () => {
  const { base, journalDir, request } = await fixture()
  const helperPath = join(base, 'stall.cjs')
  await writeFile(helperPath, `const fs=require('node:fs');const p=process.argv[2];let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{let j=JSON.parse(fs.readFileSync(p));j.phase='started';j.updated_at=new Date().toISOString();fs.writeFileSync(p,JSON.stringify(j));setInterval(()=>{},1000)})`)
  const result = await runWindowsApplyHelper({ request, journalDir, helperPath,
    executablePath: process.execPath, timeoutMs: 1500 })
  assert.equal(result.status, 'indeterminate')
  assert.equal((await classifyWindowsHelperRecovery(result.journalPath)).status, 'requires-review')
  // This simulates stalled child liveness, not a real NT STATUS_PENDING provider.
  // The durable operation ID also prevents an automatic second dispatch.
  await assert.rejects(runWindowsApplyHelper({ request, journalDir, helperPath,
    executablePath: process.execPath, timeoutMs: 1000 }), { code: 'EEXIST' })
  assert.equal(await readFile(join(base, 'outside-sentinel'), 'utf8'), 'untouched')
})

test('oversized child output stops supervision without claiming mutation failure', async () => {
  const { base, journalDir, request } = await fixture()
  const helperPath = join(base, 'overflow.cjs')
  await writeFile(helperPath, `const fs=require('node:fs');const p=process.argv[2];process.stdin.on('data',()=>{});process.stdin.on('end',()=>{let j=JSON.parse(fs.readFileSync(p));j.phase='started';j.updated_at=new Date().toISOString();fs.writeFileSync(p,JSON.stringify(j));process.stderr.write('x'.repeat(20000));setInterval(()=>{},1000)})`)
  const result = await runWindowsApplyHelper({ request, journalDir, helperPath,
    executablePath: process.execPath, timeoutMs: 2000 })
  assert.equal(result.status, 'indeterminate')
  assert.equal(result.code, 'MERGE_HELPER_OUTPUT_LIMIT')
  assert.equal(await readFile(join(base, 'outside-sentinel'), 'utf8'), 'untouched')
})

test.skipIf(process.platform !== 'win32')('real child commits one pinned rename and records terminal identity', async () => {
  const { base, root, journalDir, request } = await fixture()
  await writeFile(join(root, 'stage.txt'), 'candidate')
  const probe = spawnSync('node', ['-e', `const n=require(process.argv[1]);const r=process.argv[2];console.log(JSON.stringify([n.identity(r,'',true),n.identity(r,'stage.txt',false)]))`,
    join(process.cwd(), 'native/windows-apply/index.cjs'), root], { encoding: 'utf8' })
  assert.equal(probe.status, 0, probe.stderr)
  const [rootId, sourceId] = JSON.parse(probe.stdout) as string[]
  const result = await runWindowsApplyHelper({ request: { ...request, expected_root_id: rootId,
    expected_source_id: sourceId, expected_destination_parent_id: rootId }, journalDir,
    helperPath: join(process.cwd(), 'native/windows-apply/helper.cjs'), executablePath: 'node', timeoutMs: 5000 })
  assert.equal(result.status, 'succeeded')
  assert.equal(await readFile(join(root, 'target.txt'), 'utf8'), 'candidate')
  const recovered = await classifyWindowsHelperRecovery(result.journalPath)
  assert.equal(recovered.status, 'requires-review')
  assert.equal(recovered.journalClaim, 'succeeded')
  assert.equal(await readFile(join(base, 'outside-sentinel'), 'utf8'), 'untouched')
})

test.skipIf(process.platform !== 'win32')('real child rejects stale identity before mutation', async () => {
  const { base, root, journalDir, request } = await fixture()
  await writeFile(join(root, 'stage.txt'), 'candidate')
  const probe = spawnSync('node', ['-e', `const n=require(process.argv[1]);console.log(n.identity(process.argv[2],'',true))`,
    join(process.cwd(), 'native/windows-apply/index.cjs'), root], { encoding: 'utf8' })
  assert.equal(probe.status, 0, probe.stderr)
  const rootId = probe.stdout.trim()
  const result = await runWindowsApplyHelper({ request: { ...request, expected_root_id: rootId,
    expected_destination_parent_id: rootId }, journalDir,
    helperPath: join(process.cwd(), 'native/windows-apply/helper.cjs'), executablePath: 'node', timeoutMs: 5000 })
  assert.equal(result.status, 'failed')
  const recovered = await classifyWindowsHelperRecovery(result.journalPath)
  assert.equal(recovered.status, 'requires-review')
  assert.equal(recovered.journalClaim, 'mutation-uncertain')
  assert.equal(await readFile(join(root, 'stage.txt'), 'utf8'), 'candidate')
  assert.equal(await readFile(join(base, 'outside-sentinel'), 'utf8'), 'untouched')
})

test('schema-valid forged terminal journal never authorizes recovery', async () => {
  const { base, journalDir, request } = await fixture()
  const helperPath = join(base, 'unused.cjs')
  await writeFile(helperPath, '')
  const result = await runWindowsApplyHelper({ request, journalDir,
    helperPath, executablePath: join(base, 'missing-node.exe'), timeoutMs: 1000 })
  const journal = JSON.parse(await readFile(result.journalPath, 'utf8')) as Record<string, unknown>
  await writeFile(result.journalPath, JSON.stringify({ ...journal, phase: 'terminal', result: 'succeeded',
    exit_code: 0, preview_hash: `sha256:${'f'.repeat(64)}` }))
  const recovered = await classifyWindowsHelperRecovery(result.journalPath)
  assert.equal(recovered.status, 'requires-review')
  assert.equal(recovered.journalClaim, 'succeeded')
  assert.equal(await readFile(join(base, 'outside-sentinel'), 'utf8'), 'untouched')
})

test.skipIf(process.platform !== 'win32')('delete postcheck refuses unsafe or ambiguous identity errors', async () => {
  for (const [code, message] of [['UNSAFE_OBJECT', 'unsafe object'], ['OPEN_FAILED', 'Could not pin (Win32 32)']]) {
    const { base, root, journalDir, request } = await fixture()
    const fakeDir = join(base, 'fake-addon')
    await mkdir(fakeDir)
    const helperPath = join(fakeDir, 'helper.cjs')
    await copyFile(join(process.cwd(), 'native/windows-apply/helper.cjs'), helperPath)
    await writeFile(join(fakeDir, 'index.cjs'), `module.exports={prepare:()=>({}),commit:()=>true,close:()=>{},identity:(_r,p)=>{if(p==='')return '${'a'.repeat(48)}';throw Object.assign(new Error('${message}'),{code:'${code}'})}}`)
    const result = await runWindowsApplyHelper({ request: { ...request, kind: 'delete', destination: '',
      expected_destination_parent_id: '' }, journalDir, helperPath, executablePath: 'node', timeoutMs: 5000 })
    assert.equal(result.status, 'indeterminate', code)
    assert.equal((await classifyWindowsHelperRecovery(result.journalPath)).journal.phase, 'indeterminate')
    assert.equal(await readFile(join(base, 'outside-sentinel'), 'utf8'), 'untouched')
    assert.equal((await readdir(root)).length, 0)
  }
})

test.skipIf(process.platform !== 'win32')('real child delete requires explicit file-not-found postcheck', async () => {
  const { base, root, journalDir, request } = await fixture()
  await writeFile(join(root, 'obsolete.txt'), 'old')
  const probe = spawnSync('node', ['-e', `const n=require(process.argv[1]);const r=process.argv[2];console.log(JSON.stringify([n.identity(r,'',true),n.identity(r,'obsolete.txt',false)]))`,
    join(process.cwd(), 'native/windows-apply/index.cjs'), root], { encoding: 'utf8' })
  assert.equal(probe.status, 0, probe.stderr)
  const [rootId, sourceId] = JSON.parse(probe.stdout) as string[]
  const result = await runWindowsApplyHelper({ request: { ...request, kind: 'delete', source: 'obsolete.txt',
    expected_root_id: rootId, expected_source_id: sourceId, destination: '', expected_destination_parent_id: '' },
    journalDir, helperPath: join(process.cwd(), 'native/windows-apply/helper.cjs'),
    executablePath: 'node', timeoutMs: 5000 })
  assert.equal(result.status, 'succeeded')
  assert.equal((await readdir(root)).includes('obsolete.txt'), false)
  assert.equal(await readFile(join(base, 'outside-sentinel'), 'utf8'), 'untouched')
})

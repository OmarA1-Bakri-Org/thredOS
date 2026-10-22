'use strict';

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const windowsTest = process.platform === 'win32' ? test : test.skip;
const native = process.platform === 'win32' ? require('./index.cjs') : null;

function removeLinksWithoutFollowing(directory) {
  for (const entry of fs.readdirSync(directory)) {
    const child = path.join(directory, entry);
    const stat = fs.lstatSync(child);
    if (stat.isSymbolicLink()) fs.unlinkSync(child);
    else if (stat.isDirectory()) removeLinksWithoutFollowing(child);
  }
}

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'threados-native-apply-'));
  const resolvedBase = fs.realpathSync.native(base);
  const resolvedTemp = fs.realpathSync.native(os.tmpdir());
  assert.equal(resolvedBase.toLowerCase().startsWith(`${resolvedTemp}${path.sep}`.toLowerCase()), true);
  const root = path.join(base, 'canonical');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'sentinel.txt'), 'outside-safe');
  t.after(() => {
    assert.equal(fs.realpathSync.native(base).toLowerCase(), resolvedBase.toLowerCase());
    removeLinksWithoutFollowing(base);
    fs.rmSync(base, { recursive: true, force: true });
  });
  return { base, root, outside };
}

function id(root, relative = '', directory = false) {
  return native.identity(root, relative, directory);
}

function runRacer(operations) {
  const code = `const fs=require('node:fs');const ops=JSON.parse(process.argv[1]);` +
    `process.stdout.write(JSON.stringify(ops.map(([from,to,replacement,kind])=>{` +
    `let first,second;try{fs.renameSync(from,to);first='moved'}catch(e){first=e.code}` +
    `try{if(kind==='junction')fs.symlinkSync(replacement,from,'junction');` +
    `else fs.writeFileSync(from,replacement);second='replaced'}catch(e){second=e.code}` +
    `return [first,second]})));`;
  const run = spawnSync(process.execPath, ['-e', code, JSON.stringify(operations)], {
    encoding: 'utf8', timeout: 15000,
  });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

windowsTest('renames a staged regular file using pinned identities and no replacement', (t) => {
  const { root } = fixture(t);
  fs.mkdirSync(path.join(root, 'journal'));
  fs.writeFileSync(path.join(root, 'journal', 'stage.txt'), 'candidate');
  const token = native.prepare(root, id(root), 'journal/stage.txt',
    id(root, 'journal/stage.txt'), 'final.txt', id(root), 'rename');
  assert.equal(native.commit(token), true);
  assert.equal(fs.readFileSync(path.join(root, 'final.txt'), 'utf8'), 'candidate');
  assert.equal(fs.existsSync(path.join(root, 'journal', 'stage.txt')), false);
  assert.throws(() => native.commit(token), { code: 'INVALID_TOKEN' });

  fs.writeFileSync(path.join(root, 'journal', 'stage.txt'), 'new');
  const second = native.prepare(root, id(root), 'journal/stage.txt',
    id(root, 'journal/stage.txt'), 'final.txt', id(root), 'rename');
  assert.throws(() => native.commit(second), { code: 'MUTATION_FAILED' });
  assert.equal(fs.readFileSync(path.join(root, 'final.txt'), 'utf8'), 'candidate');
  assert.equal(fs.readFileSync(path.join(root, 'journal', 'stage.txt'), 'utf8'), 'new');
});

windowsTest('delete pins the expected regular file and refuses stale or unsafe paths', (t) => {
  const { root, outside } = fixture(t);
  fs.writeFileSync(path.join(root, 'old.txt'), 'old');
  assert.throws(() => native.prepare(root, id(root), 'old.txt', 'wrong-id', '', '', 'delete'),
    { code: 'STALE_IDENTITY' });
  const token = native.prepare(root, id(root), 'old.txt', id(root, 'old.txt'), '', '', 'delete');
  assert.equal(native.commit(token), true);
  assert.equal(fs.existsSync(path.join(root, 'old.txt')), false);
  assert.throws(() => native.identity(root, '../outside/sentinel.txt', false), { code: 'INVALID_PATH' });
  assert.throws(() => native.identity(root, 'NUL.txt', false), { code: 'INVALID_PATH' });
  fs.symlinkSync(outside, path.join(root, 'link'), 'junction');
  assert.throws(() => native.identity(root, 'link/sentinel.txt', false), { code: 'UNSAFE_OBJECT' });
  assert.equal(fs.readFileSync(path.join(outside, 'sentinel.txt'), 'utf8'), 'outside-safe');
});

windowsTest('cross-process root, parent, target, and stage swaps fail at the barrier', (t) => {
  const { base, root, outside } = fixture(t);
  const journal = path.join(root, 'journal');
  const parent = path.join(root, 'parent');
  fs.mkdirSync(journal);
  fs.mkdirSync(parent);
  fs.writeFileSync(path.join(journal, 'stage.txt'), 'candidate');
  fs.writeFileSync(path.join(parent, 'target.txt'), 'original');
  const recovery = path.join(root, 'journal', 'intent.json');
  fs.writeFileSync(recovery, JSON.stringify({ state: 'prepared', stage: 'journal/stage.txt', target: 'parent/target.txt' }));
  const rootId = id(root);
  const stageId = id(root, 'journal/stage.txt');
  const targetId = id(root, 'parent/target.txt');
  const backup = native.prepare(root, rootId, 'parent/target.txt', targetId,
    'journal/backup.txt', id(root, 'journal', true), 'rename');
  const install = native.prepare(root, rootId, 'journal/stage.txt', stageId,
    'parent/target.txt', id(root, 'parent', true), 'rename');
  const racer = runRacer([
    [root, path.join(base, 'root-moved'), outside, 'junction'],
    [parent, path.join(base, 'parent-moved'), outside, 'junction'],
    [path.join(parent, 'target.txt'), path.join(outside, 'stolen-target.txt'), 'poison-target', 'file'],
    [path.join(journal, 'stage.txt'), path.join(outside, 'stolen-stage.txt'), 'poison-stage', 'file'],
  ]);
  assert.equal(racer.every(([move, replace]) => move !== 'moved' && replace !== 'replaced'),
    true, JSON.stringify(racer));
  assert.equal(native.commit(backup), true);
  assert.equal(fs.readFileSync(path.join(outside, 'sentinel.txt'), 'utf8'), 'outside-safe');
  assert.equal(fs.existsSync(path.join(outside, 'stolen-target.txt')), false);
  assert.equal(fs.existsSync(path.join(outside, 'stolen-stage.txt')), false);
  assert.equal(fs.readFileSync(recovery, 'utf8').includes('prepared'), true);
  assert.equal(native.commit(install), true);
  assert.equal(fs.readFileSync(path.join(parent, 'target.txt'), 'utf8'), 'candidate');
  assert.equal(fs.readFileSync(path.join(journal, 'backup.txt'), 'utf8'), 'original');
});

windowsTest('a destination parent changed since preview fails before mutation', (t) => {
  const { root } = fixture(t);
  fs.mkdirSync(path.join(root, 'dest'));
  fs.writeFileSync(path.join(root, 'stage.txt'), 'candidate');
  const oldParent = id(root, 'dest', true);
  fs.renameSync(path.join(root, 'dest'), path.join(root, 'dest-old'));
  fs.mkdirSync(path.join(root, 'dest'));
  assert.throws(() => native.prepare(root, id(root), 'stage.txt', id(root, 'stage.txt'),
    'dest/result.txt', oldParent, 'rename'), { code: 'STALE_IDENTITY' });
  assert.equal(fs.readFileSync(path.join(root, 'stage.txt'), 'utf8'), 'candidate');
});

windowsTest('malformed direct native calls return typed errors without touching files', (t) => {
  const { root } = fixture(t);
  fs.writeFileSync(path.join(root, 'stage.txt'), 'candidate');
  const rootId = id(root);
  const stageId = id(root, 'stage.txt');
  assert.throws(() => native.prepare(root, {}, 'stage.txt', stageId,
    'result.txt', rootId, 'rename'), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => native.prepare(root, rootId, 'stage.txt', {},
    'result.txt', rootId, 'rename'), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => native.prepare(root, rootId, 'stage.txt', stageId,
    'result.txt', {}, 'rename'), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => native.identity(root, 12, false), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => native.commit({}), { code: 'INVALID_TOKEN' });
  assert.equal(fs.readFileSync(path.join(root, 'stage.txt'), 'utf8'), 'candidate');
  assert.equal(fs.existsSync(path.join(root, 'result.txt')), false);
});

windowsTest('pre-existing writable mapping makes preparation fail closed', async (t) => {
  const { root } = fixture(t);
  const target = path.join(root, 'mapped.txt');
  fs.writeFileSync(target, 'original');
  const script = 'import mmap,sys; f=open(sys.argv[1],"r+b"); m=mmap.mmap(f.fileno(),0); f.close(); print("READY",flush=True); sys.stdin.readline(); m[0:4]=b"evil"; m.flush(); print("DONE",flush=True); m.close()';
  const child = spawn('python', ['-u', '-c', script, target], { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.setEncoding('utf8');
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('READY')) resolve();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (!output.includes('READY')) reject(new Error(`mapping child exited ${code}`));
    });
  });
  await ready;
  const completed = new Promise((resolve, reject) => {
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`mapping child exited ${code}`)));
    child.once('error', reject);
  });
  try {
    assert.throws(() => native.prepare(root, id(root), 'mapped.txt', id(root, 'mapped.txt'),
      'backup.txt', id(root), 'rename'), { code: 'OPEN_FAILED' });
    assert.equal(fs.existsSync(path.join(root, 'backup.txt')), false);
  } finally {
    child.stdin.write('go\n');
    await completed;
  }
  // The write below belongs to the external mapper after preparation failed.
  // It is not evidence of a mutation while a native token was pinned.
  assert.equal(fs.readFileSync(target, 'utf8'), 'evilinal');
});

windowsTest('a writable mapping cannot start after a source handle has been pinned', (t) => {
  const { root } = fixture(t);
  const source = path.join(root, 'stage.txt');
  fs.writeFileSync(source, 'candidate');
  const token = native.prepare(root, id(root), 'stage.txt', id(root, 'stage.txt'),
    'installed.txt', id(root), 'rename');
  const script = 'import mmap,sys; f=open(sys.argv[1],"r+b"); m=mmap.mmap(f.fileno(),0); m[0:4]=b"evil"; m.flush(); m.close(); f.close()';
  const attacker = spawnSync('python', ['-c', script, source], { encoding: 'utf8' });
  assert.notEqual(attacker.status, 0, 'writable mapping unexpectedly opened a pinned file');
  assert.equal(native.commit(token), true);
  assert.equal(fs.readFileSync(path.join(root, 'installed.txt'), 'utf8'), 'candidate');
});

windowsTest('a concurrent destination-parent junction swap cannot redirect preparation outside root', async (t) => {
  const { base, root, outside } = fixture(t);
  fs.mkdirSync(path.join(root, 'parent'));
  fs.writeFileSync(path.join(root, 'stage.txt'), 'candidate');
  const rootId = id(root);
  const stageId = id(root, 'stage.txt');
  const parentId = id(root, 'parent', true);
  const parent = path.join(root, 'parent');
  const moved = path.join(base, 'parent-moved');
  const script = `const fs=require('node:fs');const [parent,moved,outside]=JSON.parse(process.argv[1]);` +
    `let movedOnce=false;for(let i=0;i<2000;i++){try{fs.renameSync(parent,moved);` +
    `fs.symlinkSync(outside,parent,'junction');movedOnce=true;break}catch{}}` +
    `process.stdout.write(JSON.stringify({movedOnce}));`;
  const racer = spawn(process.execPath, ['-e', script, JSON.stringify([parent, moved, outside])], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const racerDone = new Promise((resolve, reject) => {
    racer.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`junction racer exited ${code}`)));
    racer.once('error', reject);
  });
  let committed = false;
  for (let i = 0; i < 80; i++) {
    try {
      const token = native.prepare(root, rootId, 'stage.txt', stageId,
        'parent/result.txt', parentId, 'rename');
      if (i >= 20) {
        assert.equal(native.commit(token), true);
        committed = true;
        break;
      }
      native.close(token);
    } catch (error) {
      assert.equal(['OPEN_FAILED', 'UNSAFE_OBJECT', 'STALE_IDENTITY'].includes(error.code),
        true, error.message);
    }
  }
  await racerDone;
  if (!committed) {
    // A successful swap before prepare must fail closed. Restore only this
    // temporary fixture and then prove the intended canonical mutation works.
    if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) fs.unlinkSync(parent);
    if (fs.existsSync(moved)) fs.renameSync(moved, parent);
    const token = native.prepare(root, rootId, 'stage.txt', stageId,
      'parent/result.txt', parentId, 'rename');
    assert.equal(native.commit(token), true);
    committed = true;
  }
  assert.equal(committed, true);
  const installedParent = fs.existsSync(moved) ? moved : parent;
  assert.equal(fs.readFileSync(path.join(installedParent, 'result.txt'), 'utf8'), 'candidate');
  assert.equal(fs.readFileSync(path.join(outside, 'sentinel.txt'), 'utf8'), 'outside-safe');
  assert.equal(fs.existsSync(path.join(outside, 'result.txt')), false);
  assert.equal(fs.existsSync(path.join(root, 'stage.txt')), false);
});

windowsTest('rename needs delete and attributes rights, not file read-data rights', (t) => {
  const { root } = fixture(t);
  const source = path.join(root, 'restricted.txt');
  const destination = path.join(root, 'moved.txt');
  fs.writeFileSync(source, 'private');
  const whoami = spawnSync('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' });
  assert.equal(whoami.status, 0, whoami.stderr);
  const sid = whoami.stdout.match(/S-1-[0-9-]+/)?.[0];
  assert.ok(sid);
  const principal = `*${sid}`;
  const sourceId = id(root, 'restricted.txt');
  const deny = spawnSync('icacls', [source, '/deny', `${principal}:(RD)`], { encoding: 'utf8' });
  assert.equal(deny.status, 0, deny.stderr || deny.stdout);
  try {
    const token = native.prepare(root, id(root), 'restricted.txt', sourceId,
      'moved.txt', id(root), 'rename');
    assert.equal(native.commit(token), true);
  } finally {
    const current = fs.existsSync(destination) ? destination : source;
    const restore = spawnSync('icacls', [current, '/remove:d', principal], { encoding: 'utf8' });
    assert.equal(restore.status, 0, restore.stderr || restore.stdout);
  }
  assert.equal(fs.readFileSync(destination, 'utf8'), 'private');
});

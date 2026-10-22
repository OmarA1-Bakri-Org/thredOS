'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, 'helper.cjs'), 'utf8');
function helper(overrides = {}) {
  const module = { exports: {} };
  const io = { ...fs, ...overrides };
  const load = name => name === 'node:fs' ? io : require(name);
  vm.runInNewContext(source, { module, require: load, Buffer, process }, { filename: 'helper.cjs' });
  return module.exports;
}

function withFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'threados-helper-identity-'));
  try { return run(root); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function changed(stat, fields) { return Object.assign(Object.create(stat), fields); }
function pathDeviceZero(file, options) {
  const stat = fs.lstatSync(file, options);
  return changed(stat, { dev: typeof stat.dev === 'bigint' ? 0n : 0 });
}
function contentRequest(text) {
  return { expected_size: Buffer.byteLength(text),
    expected_sha256: `sha256:${crypto.createHash('sha256').update(text).digest('hex')}` };
}

test('normal journal tolerates path-stat device zero while binding opened handles', () => withFixture(root => {
  const file = path.join(root, 'op.json');
  fs.writeFileSync(file, JSON.stringify({ binding: 'expected' }));
  const journal = helper({ lstatSync: pathDeviceZero }).journalAt(file, 'op');
  assert.equal(journal.binding, 'expected');
}));

test('normal content tolerates path-stat device zero and still verifies bytes', () => withFixture(root => {
  const file = path.join(root, 'content');
  fs.writeFileSync(file, 'candidate');
  helper({ lstatSync: pathDeviceZero }).verifiedContent(file, contentRequest('candidate'));
  assert.throws(() => helper({ lstatSync: pathDeviceZero }).verifiedContent(file, contentRequest('different')),
    { code: 'MERGE_HELPER_CONTENT_CHANGED' });
}));

test('journal rejects a path replaced between primary and verification opens and closes descriptors', () => withFixture(root => {
  const file = path.join(root, 'op.json');
  fs.writeFileSync(file, JSON.stringify({ binding: 'expected' }));
  const descriptors = new Set();
  let opens = 0;
  const guarded = helper({
    openSync(name, ...args) {
      if (name === file && ++opens === 2) {
        fs.renameSync(file, path.join(root, 'old'));
        fs.writeFileSync(file, JSON.stringify({ binding: 'replacement' }));
      }
      const fd = fs.openSync(name, ...args); descriptors.add(fd); return fd;
    },
    closeSync(fd) { descriptors.delete(fd); return fs.closeSync(fd); },
  });
  assert.throws(() => guarded.journalAt(file, 'op'), { code: 'MERGE_HELPER_INVALID_JOURNAL' });
  assert.equal(descriptors.size, 0);
}));

test('same inode with a different opened device is rejected, including zero path device', () => withFixture(root => {
  const file = path.join(root, 'op.json');
  fs.writeFileSync(file, '{}');
  let stats = 0;
  const guarded = helper({ lstatSync: pathDeviceZero, fstatSync(fd, options) {
    const stat = fs.fstatSync(fd, options);
    return ++stats === 2 ? changed(stat, { dev: typeof stat.dev === 'bigint' ? stat.dev + 1n : stat.dev + 1 }) : stat;
  } });
  assert.throws(() => guarded.journalAt(file, 'op'), { code: 'MERGE_HELPER_INVALID_JOURNAL' });
}));

test('distinct high inode identities cannot collapse through Number rounding', () => withFixture(root => {
  const file = path.join(root, 'op.json');
  fs.writeFileSync(file, '{}');
  const primaryId = 2n ** 53n;
  const namedId = primaryId + 1n;
  assert.equal(Number(primaryId), Number(namedId));
  let stats = 0;
  const guarded = helper({ lstatSync(name, options) {
    const stat = fs.lstatSync(name, options);
    return name === file ? changed(stat, { ino: namedId }) : stat;
  }, fstatSync(fd, options) {
    return changed(fs.fstatSync(fd, options), { ino: ++stats === 1 ? primaryId : namedId });
  } });
  assert.throws(() => guarded.journalAt(file, 'op'), { code: 'MERGE_HELPER_INVALID_JOURNAL' });
}));

test('journal and content reject hard-linked regular files', () => withFixture(root => {
  const file = path.join(root, 'op.json');
  fs.writeFileSync(file, '{}');
  fs.linkSync(file, path.join(root, 'alias'));
  assert.throws(() => helper().journalAt(file, 'op'), { code: 'MERGE_HELPER_INVALID_JOURNAL' });
  assert.throws(() => helper().verifiedContent(file, contentRequest('{}')), { code: 'MERGE_HELPER_CONTENT_CHANGED' });
}));

test('symlink metadata refuses before opening any file without needing Windows symlink privileges', () => withFixture(root => {
  const file = path.join(root, 'op.json');
  fs.writeFileSync(file, '{}');
  let opens = 0;
  const guarded = helper({ lstatSync(name, options) {
    const stat = fs.lstatSync(name, options);
    return name === file ? changed(stat, { isSymbolicLink: () => true }) : stat;
  }, openSync(...args) { opens++; return fs.openSync(...args); } });
  assert.throws(() => guarded.journalAt(file, 'op'), { code: 'MERGE_HELPER_INVALID_JOURNAL' });
  assert.throws(() => guarded.verifiedContent(file, contentRequest('{}')), { code: 'MERGE_HELPER_CONTENT_CHANGED' });
  assert.equal(opens, 0);
}));

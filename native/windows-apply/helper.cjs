'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_REQUEST_BYTES = 16 * 1024;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const IDENTITY = /^[a-fA-F0-9]{48}$/;
const OPERATION_ID = /^[a-zA-Z0-9_-]{1,100}$/;

function sha256(text) { return `sha256:${crypto.createHash('sha256').update(text).digest('hex')}`; }
function fail(code) { throw Object.assign(new Error(code), { code }); }

function portable(value, empty = false) {
  if (value === '' && empty) return true;
  if (typeof value !== 'string' || !value || value.length > 4096 || value.normalize('NFC') !== value
      || value.includes('\\') || path.posix.isAbsolute(value) || path.posix.normalize(value) !== value) return false;
  return value.split('/').every(part => part && part !== '.' && part !== '..' && part.length <= 255
    && !/[\x00-\x1f\x7f<>:"|?*]/.test(part) && !/[. ]$/.test(part)
    && !/^(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|CLOCK\$|COM[0-9¹²³]|LPT[0-9¹²³])(?:\.|$)/i.test(part));
}

function validate(request) {
  if (!portable(request?.source) || !portable(request?.destination, request?.kind === 'delete')) fail('MERGE_HELPER_INVALID_REQUEST');
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
      request.schema_version !== 1 || !OPERATION_ID.test(request.operation_id) ||
      typeof request.root !== 'string' || request.root.length > 4096 || !path.isAbsolute(request.root) ||
      !IDENTITY.test(request.expected_root_id) || typeof request.source !== 'string' ||
      !request.source || request.source.length > 4096 || !IDENTITY.test(request.expected_source_id) ||
      typeof request.destination !== 'string' || request.destination.length > 4096 ||
      typeof request.expected_destination_parent_id !== 'string' ||
      !['rename', 'delete', 'stage'].includes(request.kind) || typeof request.plan_id !== 'string' ||
      !request.plan_id || request.plan_id.length > 256 ||
      !['plan_hash', 'preview_hash', 'approval_hash', 'root_hash']
        .every(field => DIGEST.test(request[field]))) fail('MERGE_HELPER_INVALID_REQUEST');
  if (request.kind === 'rename' && (!request.destination || !IDENTITY.test(request.expected_destination_parent_id))) {
    fail('MERGE_HELPER_INVALID_REQUEST');
  }
  if (request.kind === 'stage' && (!request.destination || !IDENTITY.test(request.expected_destination_parent_id)
      || typeof request.content_file !== 'string' || !path.isAbsolute(request.content_file)
      || !DIGEST.test(request.expected_sha256) || !Number.isSafeInteger(request.expected_size)
      || request.expected_size < 0 || !Number.isInteger(request.expected_mode)
      || request.expected_mode < 0 || request.expected_mode > 0o777)) fail('MERGE_HELPER_INVALID_REQUEST');
  if (request.kind === 'delete' && (request.destination || request.expected_destination_parent_id)) {
    fail('MERGE_HELPER_INVALID_REQUEST');
  }
}

function regular(stat) {
  return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n && stat.ino > 0n;
}

function sameIdentity(left, right) { return left.dev === right.dev && left.ino === right.ino; }

function verifyOpenedFile(fd, file, code, named = fs.lstatSync(file, { bigint: true })) {
  if (!regular(named)) fail(code);
  const opened = fs.fstatSync(fd, { bigint: true });
  const peer = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const rebound = fs.fstatSync(peer, { bigint: true });
    const current = fs.lstatSync(file, { bigint: true });
    // Node 22 on Windows can report lstat.dev=0 but a real volume from fstat.
    // Compare devices within the same API, retaining both handle and named-file
    // bindings. BigInt avoids rounded inode comparisons. No zero-device bypass.
    if (![opened, rebound, current].every(regular)
        || !sameIdentity(opened, rebound) || !sameIdentity(named, current)
        || opened.ino !== named.ino || rebound.ino !== current.ino) fail(code);
  } finally { fs.closeSync(peer); }
  return opened;
}

function openVerifiedFile(file, code) {
  const named = fs.lstatSync(file, { bigint: true });
  if (!regular(named)) fail(code);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try { verifyOpenedFile(fd, file, code, named); return fd; }
  catch (error) { fs.closeSync(fd); throw error; }
}

function verifiedContent(file, request, output) {
  const fd = openVerifiedFile(file, 'MERGE_HELPER_CONTENT_CHANGED');
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (before.size !== BigInt(request.expected_size)) fail('MERGE_HELPER_CONTENT_CHANGED');
    const digest = crypto.createHash('sha256'), buffer = Buffer.alloc(64 * 1024);
    let size = 0;
    while (true) {
      const count = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!count) break;
      size += count;
      if (size > request.expected_size) fail('MERGE_HELPER_CONTENT_CHANGED');
      digest.update(buffer.subarray(0, count));
      if (output !== undefined) { let offset = 0; while (offset < count) offset += fs.writeSync(output, buffer, offset, count - offset); }
    }
    const after = verifyOpenedFile(fd, file, 'MERGE_HELPER_CONTENT_CHANGED');
    if (size !== request.expected_size || `sha256:${digest.digest('hex')}` !== request.expected_sha256
        || before.dev !== after.dev || before.ino !== after.ino || before.mtimeNs !== after.mtimeNs
        || before.ctimeNs !== after.ctimeNs || before.size !== after.size) fail('MERGE_HELPER_CONTENT_CHANGED');
  } finally { fs.closeSync(fd); }
}

function journalAt(journalPath, operationId) {
  if (!path.isAbsolute(journalPath) || path.basename(journalPath) !== `${operationId}.json`) {
    fail('MERGE_HELPER_INVALID_JOURNAL');
  }
  const parent = path.dirname(journalPath);
  const parentStat = fs.lstatSync(parent);
  const journalStat = fs.lstatSync(journalPath);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink() ||
      fs.realpathSync.native(parent) !== parent || !journalStat.isFile() ||
      journalStat.isSymbolicLink() || journalStat.size > MAX_REQUEST_BYTES) fail('MERGE_HELPER_INVALID_JOURNAL');
  const fd = openVerifiedFile(journalPath, 'MERGE_HELPER_INVALID_JOURNAL');
  try {
    if (fs.fstatSync(fd, { bigint: true }).size > BigInt(MAX_REQUEST_BYTES)) fail('MERGE_HELPER_INVALID_JOURNAL');
    const text = fs.readFileSync(fd, 'utf8');
    verifyOpenedFile(fd, journalPath, 'MERGE_HELPER_INVALID_JOURNAL');
    if (Buffer.byteLength(text) > MAX_REQUEST_BYTES) fail('MERGE_HELPER_INVALID_JOURNAL');
    return JSON.parse(text);
  } finally { fs.closeSync(fd); }
}

function persist(journalPath, journal) {
  const tmp = `${journalPath}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify(journal)}\n`); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  try { fs.renameSync(tmp, journalPath); }
  catch (error) { try { fs.unlinkSync(tmp); } catch { /* preserve first error */ } throw error; }
}

function update(journalPath, journal, fields) {
  const next = { ...journal, ...fields, updated_at: new Date().toISOString() };
  persist(journalPath, next);
  return next;
}

function emit(status, operationId, code) {
  process.stdout.write(`${JSON.stringify({ status, operation_id: operationId, code })}\n`);
}

function readRequest() {
  return new Promise((resolve, reject) => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      text += chunk;
      if (Buffer.byteLength(text) > MAX_REQUEST_BYTES) reject(new Error('MERGE_HELPER_REQUEST_TOO_LARGE'));
    });
    process.stdin.once('end', () => resolve(text.trim()));
    process.stdin.once('error', reject);
  });
}

async function main() {
  const serialized = await readRequest();
  const request = JSON.parse(serialized);
  validate(request);
  const journalPath = process.argv[2];
  let journal = journalAt(journalPath, request.operation_id);
  if (journal.phase !== 'launch' || journal.pid !== process.pid ||
      journal.operation_id !== request.operation_id || journal.request_hash !== sha256(serialized) ||
      journal.plan_id !== request.plan_id ||
      ['plan_hash', 'preview_hash', 'approval_hash', 'root_hash']
        .some(field => journal[field] !== request[field])) fail('MERGE_HELPER_BINDING_MISMATCH');
  const native = require('./index.cjs');
  let token;
  let started = false;
  try {
    if (request.kind === 'stage') {
      const parent = path.posix.dirname(request.destination);
      token = native.pinDirectory(request.root, request.expected_root_id, parent === '.' ? '' : parent, request.expected_destination_parent_id);
      journal = update(journalPath, journal, { phase: 'prepared' });
      journal = update(journalPath, journal, { phase: 'started' });
      started = true;
      const destination = path.join(request.root, request.destination);
      const fd = fs.openSync(destination, 'wx', request.expected_mode);
      try { verifiedContent(request.content_file, request, fd); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      verifiedContent(destination, request);
      const identity = native.identity(request.root, request.destination, false);
      journal = update(journalPath, journal, { phase: 'terminal', result: 'succeeded', exit_code: 0, destination_identity_after: identity });
      native.close(token); token = null;
      emit('succeeded', request.operation_id, 'MERGE_HELPER_SUCCEEDED');
      return;
    }
    token = native.prepare(request.root, request.expected_root_id, request.source,
      request.expected_source_id, request.destination, request.expected_destination_parent_id, request.kind);
    const sourceParent = path.posix.dirname(request.source);
    const sourceParentRelative = sourceParent === '.' ? '' : sourceParent;
    const sourceParentId = request.kind === 'delete'
      ? native.identity(request.root, sourceParentRelative, true) : null;
    // prepare pins the regular file against writes/deletes before content verification.
    if (request.expected_sha256) verifiedContent(path.join(request.root, request.source), request);
    journal = update(journalPath, journal, { phase: 'prepared' });
    journal = update(journalPath, journal, { phase: 'started' });
    started = true;
    native.commit(token);
    token = null;
    let destinationId = null;
    if (request.kind === 'rename') {
      destinationId = native.identity(request.root, request.destination, false);
      if (destinationId !== request.expected_source_id) fail('MERGE_HELPER_POST_IDENTITY_MISMATCH');
    } else {
      const checkParent = () => {
        if (native.identity(request.root, '', true) !== request.expected_root_id ||
            native.identity(request.root, sourceParentRelative, true) !== sourceParentId) {
          fail('MERGE_HELPER_POST_PARENT_CHANGED');
        }
      };
      checkParent();
      let explicitlyMissing = false;
      try { native.identity(request.root, request.source, false); }
      catch (error) {
        // The current addon reports an absent final file as OPEN_FAILED (Win32 2).
        // Sharing failures, unsafe objects, root drift, and missing parents are uncertain.
        if (error?.code === 'OPEN_FAILED' && /\(Win32 2\)$/.test(error.message)) explicitlyMissing = true;
        else throw error;
      }
      if (!explicitlyMissing) fail('MERGE_HELPER_SOURCE_STILL_PRESENT');
      checkParent();
    }
    journal = update(journalPath, journal, {
      phase: 'terminal', result: 'succeeded', exit_code: 0,
      source_identity_after: null, destination_identity_after: destinationId,
    });
    emit('succeeded', request.operation_id, 'MERGE_HELPER_SUCCEEDED');
    process.exitCode = 0;
  } catch (error) {
    const code = typeof error?.code === 'string' ? error.code : 'MERGE_HELPER_OPERATION_ERROR';
    try {
      journal = update(journalPath, journal, started
        ? { phase: 'indeterminate', error_code: code, exit_code: 2 }
        : { phase: 'terminal', result: 'failed', error_code: code, exit_code: 1 });
    } catch { /* parent retains prior durable phase for recovery */ }
    emit(started ? 'indeterminate' : 'failed', request.operation_id, code);
    process.exitCode = started ? 2 : 1;
  } finally {
    if (token) native.close(token);
  }
}

module.exports = { journalAt, verifiedContent };

if (require.main === module) main().catch(error => {
  const code = typeof error?.code === 'string' ? error.code : 'MERGE_HELPER_SETUP_ERROR';
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
});

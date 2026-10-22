'use strict';

if (process.platform !== 'win32') {
  throw Object.assign(new Error('The native apply adapter requires Windows'), { code: 'UNSUPPORTED_PLATFORM' });
}

// The service persists its intent and rollback journal before calling prepare.
// This module exposes only handle-bound file primitives; it never authorizes an apply.
module.exports = require('./build/Release/windows_apply.node');

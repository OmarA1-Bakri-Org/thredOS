'use strict';

const { spawnSync } = require('node:child_process');

if (process.platform !== 'win32') {
  console.log('Windows native apply build skipped on this host');
  process.exit(0);
}

const nodeGyp = require.resolve('node-gyp/bin/node-gyp.js');
const result = spawnSync(process.execPath, [nodeGyp, 'rebuild', '--directory', __dirname], {
  stdio: 'inherit',
  shell: false,
});
if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);

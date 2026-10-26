'use strict';
// A distributable ZIP is produced only after signature, notarization ticket,
// and Gatekeeper validation succeed, including a fresh archive extraction.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const env = { ...process.env, APPLE_KEYCHAIN_PROFILE: process.env.APPLE_KEYCHAIN_PROFILE || 'reservation-helper' };
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`${command} failed (${result.status})`);
}
function verify(app) {
  run('codesign', ['--verify', '--deep', '--strict', app]);
  run('xcrun', ['stapler', 'validate', app]);
  run('spctl', ['--assess', '--type', 'execute', '--verbose=4', app]);
}
if (process.platform !== 'darwin') throw Error('The notarized Mac release must be built on macOS.');
run(process.execPath, [require.resolve('electron-builder/cli.js'), '--mac', 'dir', '--universal', '--publish', 'never']);
const app = path.join(root, 'dist/mac-universal/Reservation Helper.app');
verify(app);
const archive = path.join(root, `dist/Reservation-Helper-${version}-universal-mac.zip`);
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'reservation-release-'));
const candidate = path.join(staging, path.basename(archive));
try {
  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, candidate]);
  const extracted = path.join(staging, 'extracted');
  run('ditto', ['-x', '-k', candidate, extracted]);
  verify(path.join(extracted, 'Reservation Helper.app'));
  fs.copyFileSync(candidate, archive);
  console.log(JSON.stringify({ archive, sha256: crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'), gatekeeper: 'accepted' }));
} finally { fs.rmSync(staging, { recursive: true, force: true }); }

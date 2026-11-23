// Build the site and upload the contents of dist/ to the server with scp.
//
// The upload target (for example `user@host:paragon`) is read from the
// PARAGON_DEPLOY_TARGET environment variable or from a `deploy.local` file in
// the project root. `*.local` files are git-ignored, so the server address
// stays out of the repository.
//
// Usage: npm run deploy            build, then upload
//        npm run deploy -- --dry-run   build, then print the scp command only

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const configFile = join(root, 'deploy.local');
const dryRun = process.argv.includes('--dry-run');

const fail = (message) => {
  console.error(`deploy: ${message}`);
  process.exit(1);
};

const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' && command === 'npm' });
  if (result.error) fail(`could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} exited with code ${result.status}`);
};

const target = (process.env.PARAGON_DEPLOY_TARGET
  || (existsSync(configFile) ? readFileSync(configFile, 'utf8') : '')).trim();
if (!target) {
  fail('no upload target. Put one like `user@host:paragon` in deploy.local or set PARAGON_DEPLOY_TARGET.');
}
if (!/^[^\s:]+:\S*$/.test(target)) fail(`upload target must look like user@host:path, got "${target}"`);

run('npm', ['run', 'build']);

// Upload each entry inside dist/ so the files land directly in the target
// directory (scp -r dist host:dir would create dir/dist when dir exists).
const entries = readdirSync(dist).map(name => join('dist', name));
if (!entries.length) fail('dist/ is empty after build');
const remoteDir = target.endsWith('/') ? target : `${target}/`;
const scpArgs = ['-r', ...entries, remoteDir];

if (dryRun) {
  console.log(`\nDry run, would run:\nscp ${scpArgs.join(' ')}`);
} else {
  console.log(`\nUploading dist/ to ${remoteDir}`);
  run('scp', scpArgs);
  console.log('Deployed.');
}

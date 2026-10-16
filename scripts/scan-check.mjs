// Runs n8n's scanner on the PUBLISHED package and turns its verdict into an exit code (the scanner itself exits 0
// even when the scan fails). Usage: node scripts/scan-check.mjs [version]   (default: the version in package.json)
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const spec = `${pkg.name}@${process.argv[2] ?? pkg.version}`;

const run = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['-y', '@n8n/scan-community-package', spec], { encoding: 'utf8', shell: process.platform === 'win32' });
const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
process.stdout.write(output);
if (run.error) { console.error(`scan-check: could not run the scanner: ${run.error.message}`); process.exit(1); }
if (!/passed all security checks/.test(output)) { console.error(`scan-check: ${spec} did not pass`); process.exit(1); }
console.log(`scan-check: ${spec} passed`);

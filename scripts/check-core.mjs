// Refuses a drifted copy of the shared core: every file listed in nodes/Qersh/lib/core.lock.json must still hash
// to the recorded SHA-256, and no extra .ts file may sit next to them. Regenerate the copy from the Qersh repository
// with `npm run export-core -- <this repo>/nodes/Qersh/lib` (packages/qersh-webhook) instead of editing it here.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lib = path.join(root, 'nodes', 'Qersh', 'lib');
const lock = JSON.parse(readFileSync(path.join(lib, 'core.lock.json'), 'utf8'));
const problems = [];

const listed = new Set(lock.files.map((f) => f.path));
for (const entry of lock.files) {
	const file = path.join(lib, ...entry.path.split('/'));
	let actual;
	try {
		actual = createHash('sha256').update(readFileSync(file)).digest('hex');
	} catch {
		problems.push(`${entry.path}: missing`);
		continue;
	}
	if (actual !== entry.sha256) problems.push(`${entry.path}: changed (expected ${entry.sha256.slice(0, 12)}…, got ${actual.slice(0, 12)}…)`);
}
for (const dir of ['core', 'node']) {
	for (const name of readdirSync(path.join(lib, dir))) {
		const rel = `${dir}/${name}`;
		if (name.endsWith('.ts') && !listed.has(rel)) problems.push(`${rel}: not part of the exported core`);
	}
}

if (problems.length) {
	console.error(`check-core: the vendored core differs from ${lock.source}:\n` + problems.map((p) => '  ' + p).join('\n'));
	process.exit(1);
}
console.log(`check-core: ok (${lock.files.length} files match ${lock.source})`);

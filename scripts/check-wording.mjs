// Legal wording guard, the same rules as scripts/check-wording.mjs in the Qersh repository: Qersh is a
// "wallet notification relay", never a payment gateway, PSP or collection service, in anything a user reads here
// (README, node and credential texts, templates, changelog, package description). A line that denies the role
// ("not a payment gateway") is the legal positioning itself and passes.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['README.md', 'CHANGELOG.md', 'package.json', 'nodes', 'credentials', 'templates'];
const TEXT = /\.(ts|mjs|js|md|json|yml|yaml|txt)$/i;
const SKIP = new Set(['node_modules', 'dist', '.git', 'lib']); // lib = the vendored core, guarded in its own repository

const FORBIDDEN = [
	/بوابة\s+دفع/u, /بوابة\s+تحصيل/u, /مقدّ?م\s+خدمات?\s+دفع\b(?!.*(ليس|لا |not))/u, /قبول\s+إلكتروني/u, /خدمة\s+تحصيل/u,
	/payment\s+gateway/i, /\bPSP\b/, /payment\s+service\s+provider(?!.*\bnot\b)/i, /collection\s+service/i, /e-?payment\s+acceptance/i,
];
const DENIAL = /(ليس|ليست|لا\s|not\s+a|never\s+a|no\s+)/u;

function* walk(p) {
	const abs = path.join(root, p);
	let st;
	try { st = statSync(abs); } catch { return; }
	if (st.isFile()) { yield p; return; }
	for (const name of readdirSync(abs)) {
		if (SKIP.has(name)) continue;
		yield* walk(path.posix.join(p, name));
	}
}

const hits = [];
for (const r of ROOTS) {
	for (const rel of walk(r)) {
		if (!TEXT.test(rel)) continue;
		readFileSync(path.join(root, rel), 'utf8').split('\n').forEach((line, i) => {
			for (const re of FORBIDDEN) {
				if (re.test(line) && !DENIAL.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
			}
		});
	}
}
if (hits.length) {
	console.error(`check-wording: ${hits.length} problem(s)\n` + hits.join('\n'));
	process.exit(1);
}
console.log('check-wording: ok');

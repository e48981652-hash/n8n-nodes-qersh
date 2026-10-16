// Builds llms-section.md, the "## n8n" section for the Qersh website's llms-full.txt, from README.md, so the
// agent-facing text is never written twice. Usage: node scripts/build-llms-section.mjs [--check]
// --check exits 1 when llms-section.md differs from what README.md produces (used by CI).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readme = readFileSync(path.join(root, 'README.md'), 'utf8').replace(/\r\n/g, '\n');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

// README sections by their "## " heading, in README order.
const sections = new Map();
let current = null;
for (const line of readme.split('\n')) {
	const m = /^## (.+)$/.exec(line);
	if (m) {
		current = m[1].trim();
		sections.set(current, []);
		continue;
	}
	if (current) sections.get(current).push(line);
}
const take = (title) => {
	if (!sections.has(title)) throw new Error(`README has no section "${title}"`);
	return sections.get(title).join('\n').trim();
};
// Headings go one level down (## -> ###) so the whole block sits under "## n8n" in llms-full.txt.
const demote = (text) => text.replace(/^### /gm, '#### ');
const firstLine = readme.split('\n').find((l) => l.startsWith('Qersh (Qersh Pay) is'));
if (!firstLine) throw new Error('README must open with the definition sentence');

const repo = pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
const out = [
	'## n8n',
	'',
	`<!-- Generated from the README of ${pkg.name} by scripts/build-llms-section.mjs. Do not edit here. -->`,
	'',
	firstLine,
	'',
	`Package: \`${pkg.name}\` (npm, MIT). Repository: ${repo}. Docs page: ${pkg.homepage}. Nodes: **Qersh Trigger** (\`qershTrigger\`) and **Qersh** (\`qersh\`); credential **Qersh Webhook API** (\`qershWebhookApi\`) with the single field \`connectionSecret\` ("Connection Key"). Everything below is the package README, section by section.`,
	'',
	...['What you get', 'Install', 'Connect a wallet in five steps', 'Qersh Trigger', 'Qersh node', 'Retries, duplicates and late deliveries', 'Security', 'Templates', 'Test locally', 'Troubleshooting', 'Links'].flatMap((t) => [`### ${t}`, '', demote(take(t)), '']),
	'### Warnings for agents',
	'',
	'- Never put a connection key into a setup link, a workflow JSON, a URL or a chat message. The default Build setup link output has no key: the phone generates the key and the merchant pastes it into the n8n credential.',
	'- The Webhook + Code templates keep the key inside the workflow; prefer the community node when it can be installed. Self-hosted n8n needs `NODE_FUNCTION_ALLOW_BUILTIN=crypto` for those templates.',
	'- Answer the phone from the workflow only with `{"status": ..., "reference": ...}` as described above; any 5xx makes the phone retry the same delivery_id later, so keep handlers idempotent.',
	'- Qersh has no hosted API: nothing can be fetched from Qersh. Everything arrives as a signed webhook, and the signature must be checked on the raw body bytes.',
	'',
];
const text = out.join('\n');
const target = path.join(root, 'llms-section.md');
if (process.argv.includes('--check')) {
	let existing = '';
	try {
		existing = readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
	} catch {}
	if (existing !== text) {
		console.error('build-llms-section: llms-section.md is stale; run node scripts/build-llms-section.mjs');
		process.exit(1);
	}
	console.log('build-llms-section: ok');
} else {
	writeFileSync(target, text);
	console.log(`wrote llms-section.md (${text.length} bytes, ${text.split('\n').length} lines)`);
}

// Checks templates/*.json against the rules of the n8n template library and of this project:
//  - the files equal what scripts/build-templates.mjs produces (no hand edits that the generator would undo);
//  - exactly one yellow overview note with "### How it works" and "### Setup", 100-300 words; section notes under 50 words;
//  - no connection key or credential id anywhere; the no-node templates keep the placeholder;
//  - every connection names an existing node; every If has both outputs wired; node names are unique;
//  - a Qersh Trigger listens to webhook.test and answers from the last node; a Webhook keeps the raw body.
// Usage: node scripts/check-templates.mjs   (exit 1 on the first failure)
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEMPLATES, TRIGGER_TYPE } from './build-templates.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'templates');
const problems = [];
const words = (s) => s.split(/\s+/).filter(Boolean).length;

const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
for (const t of TEMPLATES) if (!files.includes(t.file)) problems.push(`${t.file}: missing (run node scripts/build-templates.mjs)`);
for (const f of files) if (!TEMPLATES.some((t) => t.file === f)) problems.push(`${f}: not produced by the generator`);

for (const t of TEMPLATES) {
	const file = path.join(dir, t.file);
	let text;
	try {
		text = readFileSync(file, 'utf8');
	} catch {
		continue;
	}
	const expected = JSON.stringify(t.build().toJSON(), null, 2) + '\n';
	if (text.replace(/\r\n/g, '\n') !== expected) problems.push(`${t.file}: differs from the generator output; run node scripts/build-templates.mjs`);
	let wf;
	try {
		wf = JSON.parse(text);
	} catch (e) {
		problems.push(`${t.file}: invalid JSON (${e.message})`);
		continue;
	}
	if (/qsk_[A-Za-z0-9_-]{8,}/.test(text)) problems.push(`${t.file}: contains what looks like a connection key`);
	if (/"credentials"\s*:/.test(text)) problems.push(`${t.file}: contains a credentials block`);
	if (wf.name.length > 80 || /[\u{1F300}-\u{1FAFF}]/u.test(wf.name)) problems.push(`${t.file}: name must be 80 characters at most and carry no emoji`);
	const names = new Set();
	for (const n of wf.nodes) {
		if (names.has(n.name)) problems.push(`${t.file}: duplicate node name ${n.name}`);
		names.add(n.name);
		if (!n.id || !n.type || !n.typeVersion || !Array.isArray(n.position)) problems.push(`${t.file}: node ${n.name} lacks id/type/typeVersion/position`);
	}
	const stickies = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.stickyNote');
	const yellow = stickies.filter((n) => (n.parameters.color ?? 1) === 1);
	if (yellow.length !== 1) problems.push(`${t.file}: ${yellow.length} yellow notes (exactly one overview note required)`);
	for (const s of yellow) {
		const c = s.parameters.content;
		if (!c.includes('### How it works') || !c.includes('### Setup')) problems.push(`${t.file}: the overview note needs "### How it works" and "### Setup"`);
		const w = words(c);
		if (w < 100 || w > 300) problems.push(`${t.file}: the overview note has ${w} words (100-300)`);
		const others = wf.nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote');
		const minX = Math.min(...others.map((n) => n.position[0]));
		const minY = Math.min(...others.map((n) => n.position[1]));
		if (s.position[0] > minX || s.position[1] > minY) problems.push(`${t.file}: the overview note must sit top-left of the workflow`);
	}
	for (const s of stickies.filter((n) => n.parameters.color === 7)) if (words(s.parameters.content) > 50) problems.push(`${t.file}: section note over 50 words: ${s.parameters.content.split('\n')[0]}`);
	for (const [from, outs] of Object.entries(wf.connections)) {
		if (!names.has(from)) problems.push(`${t.file}: connection from unknown node ${from}`);
		for (const out of outs.main) for (const c of out) if (!names.has(c.node)) problems.push(`${t.file}: connection to unknown node ${c.node}`);
	}
	for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.if')) {
		const outs = wf.connections[n.name]?.main ?? [];
		if (!(outs[0]?.length > 0) || !(outs[1]?.length > 0)) problems.push(`${t.file}: If node "${n.name}" must have both outputs connected`);
	}
	const trigger = wf.nodes.find((n) => n.type === TRIGGER_TYPE);
	const webhook = wf.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
	if (!trigger && !webhook) problems.push(`${t.file}: no Qersh Trigger and no Webhook node`);
	if (trigger) {
		if (!trigger.parameters.events?.includes('webhook.test')) problems.push(`${t.file}: the trigger must listen to webhook.test`);
		if (trigger.parameters.responseMode !== 'lastNode') problems.push(`${t.file}: the trigger must answer from the last node`);
		if (!trigger.webhookId) problems.push(`${t.file}: the trigger needs a webhookId`);
	}
	if (webhook) {
		if (webhook.parameters.options?.rawBody !== true) problems.push(`${t.file}: the Webhook node must keep the raw body`);
		if (webhook.parameters.responseMode !== 'responseNode') problems.push(`${t.file}: the Webhook node must answer through Respond to Webhook`);
		const settings = wf.nodes.find((n) => n.name === 'Settings');
		const keyField = settings?.parameters.assignments.assignments.find((a) => a.name === 'connection_key');
		if (!keyField || !/^paste-/.test(keyField.value)) problems.push(`${t.file}: Settings must hold the connection key placeholder`);
		if (!stickies.some((n) => n.parameters.color === 3)) problems.push(`${t.file}: a red note must warn about the key in the workflow`);
	}
	for (const n of wf.nodes) {
		const type = n.type;
		const s = JSON.stringify(n.parameters);
		if (type === 'n8n-nodes-base.telegram' && !s.includes('appendAttribution":false')) problems.push(`${t.file}: Telegram node must switch the attribution line off`);
	}
}

if (problems.length > 0) {
	for (const p of problems) console.error('check-templates: ' + p);
	process.exit(1);
}
console.log(`check-templates: ok (${TEMPLATES.length} templates)`);

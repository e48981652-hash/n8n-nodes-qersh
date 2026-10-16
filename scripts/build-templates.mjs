// Generates the workflow templates in templates/*.json. The shared pieces (connection-test branch, reply nodes,
// the signature-check Code node, the sticky notes) are written once here so the six files cannot drift apart.
//   node scripts/build-templates.mjs          writes templates/*.json
// CI rebuilds them and fails when the committed files differ. Nothing here holds a key: the no-node templates keep a
// placeholder in their "Settings" node, which the merchant replaces inside n8n.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'templates');
mkdirSync(outDir, { recursive: true });

export const PACKAGE = '@qersh-pay/n8n-nodes-qersh';
export const TRIGGER_TYPE = PACKAGE + '.qershTrigger';
export const NODE_TYPE = PACKAGE + '.qersh';
const DOCS = 'https://qersh.cfd/en/integrations/n8n';
const KEY_PLACEHOLDER = 'paste-the-connection-key-shown-by-the-phone';

// Deterministic ids: the same template always serialises the same way.
const uid = (seed) => {
	const h = createHash('sha256').update(seed).digest('hex');
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const X = 240;
const Y = 200;
const pos = (col, row) => [col * X, row * Y];

class Workflow {
	constructor(name, seed) {
		this.name = name;
		this.seed = seed;
		this.nodes = [];
		this.connections = {};
		this.stickies = 0;
	}
	add(node) {
		if (this.nodes.some((n) => n.name === node.name)) throw new Error(`duplicate node name ${node.name} in ${this.name}`);
		node.id = uid(this.seed + ':' + node.name);
		this.nodes.push(node);
		return node.name;
	}
	connect(from, to, output = 0) {
		if (!this.nodes.some((n) => n.name === from) || !this.nodes.some((n) => n.name === to)) throw new Error(`unknown node in connection ${from} -> ${to}`);
		const main = (this.connections[from] ??= { main: [] }).main;
		while (main.length <= output) main.push([]);
		main[output].push({ node: to, type: 'main', index: 0 });
	}
	sticky(content, position, width, height, color) {
		const name = this.stickies === 0 ? 'Sticky Note' : `Sticky Note${this.stickies}`;
		this.stickies++;
		return this.add({ parameters: { content, height, width, color }, name, type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position });
	}
	toJSON() {
		return { name: this.name, nodes: this.nodes, connections: this.connections, settings: { executionOrder: 'v1' }, pinData: {}, meta: { templateCredsSetupCompleted: false } };
	}
}

// ── node factories (parameter shapes of n8n 2.43, see docs/12 in the Qersh repository) ────────────────────────────
const condition = (seed, leftValue, operator, rightValue = '') => ({ id: uid('cond:' + seed), leftValue, rightValue, operator });
const isTrue = (seed, expr) => condition(seed, expr, { type: 'boolean', operation: 'true', singleValue: true });
const equals = (seed, expr, value) => condition(seed, expr, { type: 'string', operation: 'equals' }, value);
const ifNode = (name, position, conditions) => ({
	parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 }, conditions, combinator: 'and' }, options: {} },
	name,
	type: 'n8n-nodes-base.if',
	typeVersion: 2.3,
	position,
});
const setFields = (name, position, fields, { keepInput = false } = {}) => ({
	parameters: {
		assignments: { assignments: fields.map((f) => ({ id: uid(name + ':' + f.name), name: f.name, value: f.value, type: f.type ?? 'string' })) },
		includeOtherFields: keepInput,
		options: keepInput ? { stripBinary: false } : {},
	},
	name,
	type: 'n8n-nodes-base.set',
	typeVersion: 3.5,
	position,
});
const setRaw = (name, position, expression) => ({
	parameters: { mode: 'raw', jsonOutput: expression, includeOtherFields: false, options: {} },
	name,
	type: 'n8n-nodes-base.set',
	typeVersion: 3.5,
	position,
});
const replyOk = (name, position) => setFields(name, position, [{ name: 'status', value: 'ok' }]);
const rl = (value = '') => ({ __rl: true, mode: 'list', value });
const schema = (columns) => columns.map((id) => ({ id, displayName: id, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true, removed: false }));
const mapper = (value, matchingColumns = []) => ({ mappingMode: 'defineBelow', value, matchingColumns, schema: schema(Object.keys(value)) });
const sheets = (name, position, parameters, extra = {}) => ({ parameters: { documentId: rl(), sheetName: rl(), ...parameters }, name, type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7, position, ...extra });
const dataTable = (name, position, parameters, extra = {}) => ({ parameters: { dataTableId: rl(), ...parameters }, name, type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position, ...extra });
const telegram = (name, position, chatId, text) => ({
	parameters: { chatId, text, additionalFields: { appendAttribution: false, parse_mode: 'HTML' } },
	name,
	type: 'n8n-nodes-base.telegram',
	typeVersion: 1.2,
	position,
});
const httpGet = (name, position, url) => ({ parameters: { url, options: { timeout: 10000 } }, name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.5, position });
const httpPost = (name, position, url, jsonBody) => ({
	parameters: { method: 'POST', url, sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody, options: { timeout: 10000 } },
	name,
	type: 'n8n-nodes-base.httpRequest',
	typeVersion: 4.5,
	position,
});
const respond = (name, position, body, code = 200) => ({
	parameters: { respondWith: 'json', responseBody: body, options: { responseCode: code } },
	name,
	type: 'n8n-nodes-base.respondToWebhook',
	typeVersion: 1.5,
	position,
});
const code = (name, position, jsCode) => ({ parameters: { jsCode }, name, type: 'n8n-nodes-base.code', typeVersion: 2, position });
const noOp = (name, position) => ({ parameters: {}, name, type: 'n8n-nodes-base.noOp', typeVersion: 1, position });

const qershTrigger = (wf, position, events) =>
	wf.add({
		parameters: { path: 'qersh', events, responseMode: 'lastNode' },
		name: 'Qersh Trigger',
		type: TRIGGER_TYPE,
		typeVersion: 1,
		position,
		webhookId: uid(wf.seed + ':webhookId'),
	});
const webhookNode = (wf, position) =>
	wf.add({
		parameters: { httpMethod: 'POST', path: 'qersh', responseMode: 'responseNode', options: { rawBody: true } },
		name: 'Webhook',
		type: 'n8n-nodes-base.webhook',
		typeVersion: 2.2,
		position,
		webhookId: uid(wf.seed + ':webhookId'),
	});

// ── expressions shared by the templates ───────────────────────────────────────────────────────────────────────────
const T = (from) => (from ? `$('${from}').item.json` : '$json');
const esc = (expr) => `String(${expr} ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')`;
const payerText = (j) => `(${j}.transfer.payer.number ?? ${j}.transfer.payer.handle ?? ${j}.transfer.payer.name ?? 'unknown payer')`;
const transferAlert = (j) =>
	`=<b>{{ ${j}.transfer.amount }} {{ ${j}.transfer.currency }}</b> received from {{ ${esc(payerText(j))} }} ({{ ${j}.wallet.provider }} {{ ${j}.wallet.number_masked }})\n` +
	`Transaction {{ ${j}.transfer.provider_txn_id ?? '-' }} · risk {{ ${j}.transfer.risk ?? '-' }} · {{ ${j}.transfer.auto_confirm_ok === true ? 'can be confirmed automatically' : 'needs a human check' }}\n` +
	`Money arrived {{ ${j}.transfer.received_at ?? ${j}.created_at }}{{ ${j}.redelivery ? ' · delivered late (' + ${j}.redelivery + ')' : '' }}`;
const forgeryAlert = (j) =>
	`=⚠️ <b>Suspected forgery</b>: the message behind transfer {{ ${j}.transfer.transfer_id }} did not match the wallet balance.\n` +
	`Do not ship the order this transfer paid until you see the money in the wallet app ({{ ${j}.wallet.provider }} {{ ${j}.wallet.number_masked }}).`;
const sheetRow = (j) => ({
	received_at: `={{ ${j}.transfer.received_at ?? ${j}.created_at }}`,
	amount: `={{ ${j}.transfer.amount }}`,
	currency: `={{ ${j}.transfer.currency }}`,
	payer_number: `={{ ${j}.transfer.payer.number ?? ${j}.transfer.payer.handle ?? '' }}`,
	payer_name: `={{ ${j}.transfer.payer.name ?? '' }}`,
	provider_txn_id: `={{ ${j}.transfer.provider_txn_id ?? '' }}`,
	wallet: `={{ ${j}.wallet.provider }} {{ ${j}.wallet.number_masked }}`,
	risk: `={{ ${j}.transfer.risk ?? '' }}`,
	auto_confirm_ok: `={{ ${j}.transfer.auto_confirm_ok === true ? 'yes' : 'no' }}`,
	transfer_id: `={{ ${j}.transfer.transfer_id }}`,
	delivery_id: `={{ ${j}.delivery_id }}`,
	status: `={{ ${j}.transfer.suspected_forgery ? 'SUSPECTED FORGERY' : (${j}.transfer.auto_confirm_ok === true ? 'ok' : 'review') }}`,
});
const matchReply = (matchNode) =>
	`={{ (() => { const m = $('${matchNode}').item.json; const r = { status: m.status }; if (m.reference) r.reference = m.reference; if (m.note) r.note = m.note; return r; })() }}`;

// ── the Code nodes of the no-node templates (plain JavaScript, no backticks: it lives inside JSON) ─────────────────
const VERIFY_CODE = [
	'// Checks X-Qersh-Signature on the raw body (qersh.v1) and turns the delivery into one item shaped like the',
	"// Qersh Trigger's output: event, delivery_id, test, wallet, transfer {...}, data, envelope. Needs the Node",
	"// 'crypto' module: on self-hosted n8n set NODE_FUNCTION_ALLOW_BUILTIN=crypto (n8n Cloud allows it).",
	"const crypto = require('crypto');",
	"const settings = $('Settings').first().json;",
	"const key = String(settings.connection_key || '').trim();",
	"const request = $('Webhook').first();",
	'const headers = request.json.headers || {};',
	"const header = String(headers['x-qersh-signature'] || '');",
	"const raw = await this.helpers.getBinaryDataBuffer(0, 'data');",
	'const refuse = (reason) => [{ json: { valid: false, reason } }];',
	"if (!key || key === '" + KEY_PLACEHOLDER + "') return refuse('no_key');",
	"if (!raw || !raw.length) return refuse('raw_body_unavailable');",
	"if (!header) return refuse('missing_header');",
	'let t = null;',
	'const sigs = [];',
	"for (const part of header.split(',')) {",
	"  const eq = part.indexOf('=');",
	'  if (eq < 0) continue;',
	'  const k = part.slice(0, eq).trim();',
	'  const v = part.slice(eq + 1).trim();',
	"  if (k === 't' && /^\\d{1,13}$/.test(v)) t = Number(v);",
	"  else if (k === 'v1' && /^[0-9a-fA-F]{64}$/.test(v)) sigs.push(v.toLowerCase());",
	'}',
	"if (t === null || sigs.length === 0) return refuse('malformed_header');",
	"if (Math.abs(Math.floor(Date.now() / 1000) - t) > 300) return refuse('stale_timestamp');",
	"const expected = crypto.createHmac('sha256', key).update(t + '.').update(raw).digest('hex');",
	"const good = sigs.some((s) => crypto.timingSafeEqual(Buffer.from(s, 'hex'), Buffer.from(expected, 'hex')));",
	"if (!good) return refuse('bad_signature');",
	'let envelope;',
	"try { envelope = JSON.parse(raw.toString('utf8')); } catch (e) { return refuse('invalid_json'); }",
	"if (!envelope || envelope.schema !== 'qersh.v1' || typeof envelope.event !== 'string') return refuse('not_qersh_v1');",
	'',
	'// 01xxxxxxxxx from any spelling, or name@instapay; null for a masked number (0111***3445).',
	'const normalizePayer = (value) => {',
	"  const s = String(value ?? '').trim().toLowerCase();",
	'  if (!s) return null;',
	"  if (s.includes('@')) return /^[a-z0-9._-]{2,64}@instapay$/.test(s) ? s : null;",
	"  let d = '';",
	'  for (const ch of s) {',
	'    const c = ch.charCodeAt(0);',
	'    if (c >= 48 && c <= 57) d += ch;',
	'    else if (c >= 1632 && c <= 1641) d += String.fromCharCode(c - 1632 + 48);',
	'    else if (c >= 1776 && c <= 1785) d += String.fromCharCode(c - 1776 + 48);',
	'  }',
	"  if (d.startsWith('00')) d = d.slice(2);",
	"  if (d.startsWith('20') && d.length >= 12) d = d.slice(2);",
	"  if (d.length === 10 && d.startsWith('1')) d = '0' + d;",
	'  if (/^01[0-9]{9}$/.test(d)) return d;',
	"  if (/^[a-z0-9._-]{2,64}$/.test(s) && /[a-z]/.test(s)) return s + '@instapay';",
	'  return null;',
	'};',
	'const str = (v) => (typeof v === \'string\' ? v : null);',
	'const summarize = (data) => {',
	"  if (!data || typeof data !== 'object') return null;",
	'  const cp = data.counterparty || {};',
	'  const reasons = Array.isArray(data.risk_reasons) ? data.risk_reasons : [];',
	"  const forgery = reasons.includes('suspected_forgery') || (data.checks && data.checks.balance_chain === 'refuted');",
	'  return {',
	'    transfer_id: str(data.transfer_id), direction: str(data.direction), status: str(data.status),',
	'    amount: str(data.amount), amount_minor: Number.isInteger(data.amount_minor) ? data.amount_minor : null,',
	'    currency: str(data.currency), received_at: str(data.received_at),',
	'    payer: { number: str(cp.number), handle: str(cp.handle), name: str(cp.name), key: normalizePayer(cp.number) ?? normalizePayer(cp.handle) },',
	'    provider_txn_id: str(data.provider_txn_id), balance_after: str(data.balance_after), risk: str(data.risk),',
	"    risk_reasons: reasons.filter((r) => typeof r === 'string'), auto_confirm_ok: typeof data.auto_confirm_ok === 'boolean' ? data.auto_confirm_ok : null,",
	"    balance_chain: data.checks ? str(data.checks.balance_chain) : null, suspected_forgery: forgery === true,",
	'  };',
	'};',
	'const event = envelope.event;',
	"const data = envelope.data && typeof envelope.data === 'object' ? envelope.data : {};",
	"const transfer = event.startsWith('transfer.') ? summarize(data) : event === 'webhook.test' ? summarize(data.sample) : null;",
	"const attempt = /^\\d{1,9}$/.test(String(headers['x-qersh-attempt'] || '')) ? Number(headers['x-qersh-attempt']) : null;",
	"const redelivery = ['manual', 'backfill'].includes(headers['x-qersh-redelivery']) ? headers['x-qersh-redelivery'] : null;",
	'return [{ json: {',
	'  valid: true, event, delivery_id: envelope.delivery_id, attempt, redelivery,',
	"  test: envelope.test === true || event === 'webhook.test', created_at: envelope.created_at,",
	'  wallet: envelope.wallet, transfer, data, envelope,',
	'} }];',
].join('\n');

const MATCH_CODE = [
	'// Pure port of kit/reference/match.mjs: the payer and the time decide, the amount only chooses between that',
	"// payer's own orders. Input: the store's reply { orders: [...] } (order_number, price_minor, paid_minor,",
	'// payer_key, created_at, expires_at). Output: the reply for the phone plus what the store must do.',
	"const transfer = $('Verify the Qersh signature').first().json.transfer;",
	'const incoming = $input.first().json;',
	'const orders = Array.isArray(incoming.orders) ? incoming.orders : Array.isArray(incoming) ? incoming : [];',
	'const LATE_MS = 120 * 60000, SKEW_MS = 10 * 60000;',
	"const time = (v) => (typeof v === 'number' ? v : v instanceof Date ? v.getTime() : Date.parse(String(v ?? '')));",
	'const done = (status, extra) => [{ json: { status, reference: null, note: null, order_number: null, amount_minor: null, transfer_id: transfer ? transfer.transfer_id : null, action: null, ...extra } }];',
	"if (!transfer) return done('review', { note: 'no transfer in this delivery' });",
	"if (transfer.auto_confirm_ok !== true) return done('review', { note: 'risk is not low: a human looks at it' });",
	"if (!transfer.payer.key) return done('unmatched', { note: 'no payer identifier in the message (masked number?)' });",
	"if (!Number.isInteger(transfer.amount_minor)) return done('review', { note: 'amount could not be read' });",
	'const amount = transfer.amount_minor;',
	'const now = Date.now();',
	'const got = time(transfer.received_at);',
	'const at = Number.isFinite(got) && got < now ? got : now;',
	'const stale = now - at > LATE_MS;',
	'const mine = orders.filter((o) => o && o.payer_key === transfer.payer.key && (o.status === undefined || o.status === \'open\' || o.status === \'partial\'));',
	'const readable = mine.filter((o) => Number.isInteger(o.price_minor) && Number.isFinite(time(o.created_at)) && Number.isFinite(time(o.expires_at)));',
	'const candidates = readable.filter((o) => time(o.expires_at) >= at - LATE_MS && time(o.created_at) <= at + SKEW_MS).sort((a, b) => time(b.created_at) - time(a.created_at));',
	'if (candidates.length === 0) {',
	"  if (readable.length < mine.length) return done('review', { note: 'an order of this payer could not be read' });",
	"  return stale ? done('review', { note: 'late delivery: no order of this payer was open when the money arrived' }) : done('unmatched');",
	'}',
	'const remainingOf = (o) => o.price_minor - (Number.isInteger(o.paid_minor) ? o.paid_minor : 0);',
	'const exact = candidates.filter((o) => remainingOf(o) === amount);',
	'const order = exact[0] ?? (candidates.length === 1 && readable.length === mine.length ? candidates[0] : null);',
	"if (!order) return done('review', { note: 'several open orders for this payer, none matches the amount' });",
	'const remaining = remainingOf(order);',
	'const base = { reference: order.order_number, order_number: order.order_number, amount_minor: amount };',
	"if (amount < remaining) return done('partial', { ...base, action: 'mark_partial' });",
	"if (time(order.expires_at) < at) return done('matched', { ...base, action: 'mark_paid', note: 'paid after expiry' });",
	"return done(amount > remaining ? 'overpaid' : 'matched', { ...base, action: 'mark_paid' });",
].join('\n');

// ── sticky notes ──────────────────────────────────────────────────────────────────────────────────────────────────
const wordCount = (s) => s.split(/\s+/).filter(Boolean).length;
const mainNote = (title, howItWorks, setup, tips) => {
	const content = `## ${title}\n\n### How it works\n${howItWorks}\n\n### Setup\n${setup}\n\n### Customization tips\n${tips}\n\nQersh (Qersh Pay) is a wallet notification relay, not a payment service provider. Docs: ${DOCS}`;
	const words = wordCount(content);
	if (words < 100 || words > 300) throw new Error(`main note of "${title}" has ${words} words (100-300 required)`);
	return content;
};
const section = (heading, lines) => {
	const content = `## ${heading}\n${lines}`;
	if (wordCount(content) > 50) throw new Error(`section note "${heading}" has more than 50 words`);
	return content;
};
const KEY_WARNING =
	'## Connection key inside the workflow\nThis template keeps the key in the **Settings** node, so it is part of the workflow JSON: do not export or share this workflow. The Qersh community node keeps the key in an encrypted n8n credential instead.';
const SETUP_COMMON = (extraSteps) =>
	`1. Add your **Qersh Webhook API** credential (install the Qersh community node first; on n8n Cloud open the nodes panel, "More from the community").\n` +
	extraSteps +
	`${extraSteps ? '' : ''}Activate the workflow, copy the trigger's **Production URL** into the Qersh app (More, Wallets, Add wallet, "your store URL"), then paste the key the phone shows into the credential. "Test connection" on the phone must say the signature was verified.`;
const SETUP_COMMON_NO_NODE = (extraSteps) =>
	`1. In **Settings**, replace the placeholder with the connection key the phone shows after you add the wallet (paste it only here).\n` +
	extraSteps +
	`Activate the workflow and copy the Webhook node's **Production URL** into the Qersh app (More, Wallets, Add wallet, "your store URL"). "Test connection" on the phone must say the signature was verified. Self-hosted n8n needs \`NODE_FUNCTION_ALLOW_BUILTIN=crypto\` for the Code node; n8n Cloud allows it.`;

const layout = { trigger: pos(0, 2) };

// ── T1 · Log wallet transfers to Google Sheets ────────────────────────────────────────────────────────────────────
function t1(variant) {
	const noNode = variant === 'webhook-code';
	const wf = new Workflow(noNode ? 'Log wallet transfers to Google Sheets (Webhook + Code)' : 'Log wallet transfers to Google Sheets', 't1:' + variant);
	let src;
	let col = 0;
	if (noNode) {
		webhookNode(wf, pos(col++, 2));
		wf.add(setFields('Settings', pos(col++, 2), [{ name: 'connection_key', value: KEY_PLACEHOLDER }], { keepInput: true }));
		wf.add(code('Verify the Qersh signature', pos(col++, 2), VERIFY_CODE));
		wf.add(ifNode('Is the signature valid?', pos(col++, 2), [isTrue('t1valid', '={{ $json.valid === true }}')]));
		wf.add(respond('Reply 401 to a bad signature', pos(col, 4), '={{ JSON.stringify({ error: "invalid_signature", reason: $json.reason }) }}', 401));
		wf.add(respond('Reply ok at once', pos(col++, 2), '{"status":"ok"}'));
		wf.connect('Webhook', 'Settings');
		wf.connect('Settings', 'Verify the Qersh signature');
		wf.connect('Verify the Qersh signature', 'Is the signature valid?');
		wf.connect('Is the signature valid?', 'Reply ok at once', 0);
		wf.connect('Is the signature valid?', 'Reply 401 to a bad signature', 1);
		src = 'Reply ok at once';
	} else {
		qershTrigger(wf, pos(col++, 2), ['transfer.received', 'transfer.updated', 'webhook.test']);
		src = 'Qersh Trigger';
	}
	const j = noNode ? T('Verify the Qersh signature') : T('Qersh Trigger');
	wf.add(ifNode('Is this the connection test?', pos(col++, 2), [isTrue('t1test', '={{ $json.test === true }}')]));
	wf.connect(src, 'Is this the connection test?');
	wf.add(ifNode('Is this a new transfer?', pos(col, 3), [equals('t1event', '={{ $json.event }}', 'transfer.received')]));
	wf.connect('Is this the connection test?', 'Is this a new transfer?', 1);
	if (noNode) {
		wf.add(noOp('Nothing to log for the test', pos(col, 1)));
		wf.connect('Is this the connection test?', 'Nothing to log for the test', 0);
	}
	col++;
	// new transfer: look the delivery up, append once
	wf.add(sheets('Look the delivery up in the sheet', pos(col, 2), { operation: 'read', filtersUI: { values: [{ lookupColumn: 'delivery_id', lookupValue: '={{ $json.delivery_id }}' }] }, combineFilters: 'AND', options: { returnFirstMatch: true } }, { alwaysOutputData: true }));
	wf.connect('Is this a new transfer?', 'Look the delivery up in the sheet', 0);
	wf.add(ifNode('Is the delivery new?', pos(col + 1, 2), [isTrue('t1new', '={{ $json.isEmpty() }}')]));
	wf.connect('Look the delivery up in the sheet', 'Is the delivery new?');
	wf.add(sheets('Append the transfer row', pos(col + 2, 1), { operation: 'append', columns: mapper(sheetRow(j)), options: {} }));
	wf.connect('Is the delivery new?', 'Append the transfer row', 0);
	// update: a forgery verdict marks the row
	wf.add(ifNode('Is it a forgery verdict?', pos(col, 4), [isTrue('t1forgery', '={{ $json.transfer?.suspected_forgery === true }}')]));
	wf.connect('Is this a new transfer?', 'Is it a forgery verdict?', 1);
	wf.add(sheets('Mark the row as suspected forgery', pos(col + 1, 4), { operation: 'update', columns: mapper({ transfer_id: '={{ $json.transfer.transfer_id }}', status: 'SUSPECTED FORGERY' }, ['transfer_id']), options: {} }));
	wf.connect('Is it a forgery verdict?', 'Mark the row as suspected forgery', 0);
	if (noNode) {
		wf.add(noOp('Nothing to change', pos(col + 1, 5)));
		wf.connect('Is it a forgery verdict?', 'Nothing to change', 1);
		wf.add(noOp('Already logged', pos(col + 2, 3)));
		wf.connect('Is the delivery new?', 'Already logged', 1);
	} else {
		wf.add(replyOk('Reply ok', pos(col + 3, 2)));
		wf.connect('Is this the connection test?', 'Reply ok', 0);
		wf.connect('Is the delivery new?', 'Reply ok', 1);
		wf.connect('Append the transfer row', 'Reply ok');
		wf.connect('Mark the row as suspected forgery', 'Reply ok');
		wf.connect('Is it a forgery verdict?', 'Reply ok', 1);
	}
	// notes
	wf.sticky(
		mainNote(
			'Log wallet transfers to Google Sheets',
			noNode
				? 'The Qersh app on the merchant\'s phone posts every incoming wallet transfer (Vodafone Cash, Orange Cash, e& money, InstaPay) to the Webhook node as a signed JSON delivery. The Code node checks the signature on the raw body with the connection key and refuses anything else with 401. A valid delivery is answered with 200 at once, the connection test is left alone, and each transfer becomes one row in your sheet: time, amount, payer, transaction id, wallet, risk. A later "suspected forgery" verdict marks the row. Repeated deliveries (the phone retries until it gets a 2xx) are found by delivery_id and not logged twice.'
				: 'The Qersh app on the merchant\'s phone posts every incoming wallet transfer (Vodafone Cash, Orange Cash, e& money, InstaPay) to the Qersh Trigger as a signed JSON delivery; the trigger verifies the signature and refuses anything else with 401. The connection test is answered without touching the sheet. Each transfer becomes one row: time, amount, payer, transaction id, wallet, risk. A later "suspected forgery" verdict marks the row. Repeated deliveries (the phone retries until it gets a 2xx) are found by delivery_id and not logged twice; the reply {"status":"ok"} tells the phone the delivery arrived.',
			(noNode ? SETUP_COMMON_NO_NODE : SETUP_COMMON)(
				'2. Create a Google Sheet with a header row: received_at, amount, currency, payer_number, payer_name, provider_txn_id, wallet, risk, auto_confirm_ok, transfer_id, delivery_id, status. Select it and your Google credential in the three Google Sheets nodes.\n3. ',
			),
			'Add columns to the append node as you like (balance_after, payer handle). Keep "Send sender details" on "full name and number" in the wallet, or the payer number arrives masked. The phone retries a failed delivery for days, so a Sheets outage loses nothing.',
		),
		[-X * 2.2, -Y * 0.6],
		480,
		noNode ? 760 : 700,
		1,
	);
	wf.sticky(section('Verify and route', noNode ? 'The Code node checks the signature and the If nodes pick the branch: test, new transfer, or a later verdict.' : 'The trigger verified the signature; the If nodes pick the branch: test, new transfer, or a later verdict.'), [noNode ? X * 1.6 : -X * 0.4, Y * 0.8], noNode ? X * 3.9 : X * 2.9, Y * 1.1, 7);
	wf.sticky(section('Log once', 'Look the delivery_id up first; append only when it is not there. Retries and backfills then never make a second row.'), [pos(col, 2)[0] - 40, Y * 1.5 + 20], X * 3.2, Y * 1.4, 7);
	wf.sticky(section('Forgery verdict', 'transfer.updated with suspected_forgery: the row is marked so nobody ships against that money.'), [pos(col, 4)[0] - 40, Y * 3.6], X * 2.2, Y * 1.2, 7);
	if (noNode) wf.sticky(KEY_WARNING, [X * 0.8, Y * 2.6], 300, 200, 3);
	return wf;
}

// ── T2 · Send a Telegram alert for every wallet transfer ───────────────────────────────────────────────────────────
function t2(variant) {
	const noNode = variant === 'webhook-code';
	const wf = new Workflow(noNode ? 'Send a Telegram alert for every wallet transfer (Webhook + Code)' : 'Send a Telegram alert for every wallet transfer', 't2:' + variant);
	let col = 0;
	let src;
	if (noNode) {
		webhookNode(wf, pos(col++, 2));
		wf.add(setFields('Settings', pos(col++, 2), [{ name: 'connection_key', value: KEY_PLACEHOLDER }, { name: 'telegram_chat_id', value: 'YOUR_TELEGRAM_CHAT_ID' }], { keepInput: true }));
		wf.add(code('Verify the Qersh signature', pos(col++, 2), VERIFY_CODE));
		wf.add(ifNode('Is the signature valid?', pos(col++, 2), [isTrue('t2valid', '={{ $json.valid === true }}')]));
		wf.add(respond('Reply 401 to a bad signature', pos(col, 4), '={{ JSON.stringify({ error: "invalid_signature", reason: $json.reason }) }}', 401));
		wf.add(respond('Reply ok at once', pos(col++, 2), '{"status":"ok"}'));
		wf.connect('Webhook', 'Settings');
		wf.connect('Settings', 'Verify the Qersh signature');
		wf.connect('Verify the Qersh signature', 'Is the signature valid?');
		wf.connect('Is the signature valid?', 'Reply ok at once', 0);
		wf.connect('Is the signature valid?', 'Reply 401 to a bad signature', 1);
		src = 'Reply ok at once';
	} else {
		qershTrigger(wf, pos(col++, 2), ['transfer.received', 'transfer.updated', 'webhook.test']);
		wf.add(setFields('Settings', pos(col++, 2), [{ name: 'telegram_chat_id', value: 'YOUR_TELEGRAM_CHAT_ID' }], { keepInput: true }));
		wf.connect('Qersh Trigger', 'Settings');
		src = 'Settings';
	}
	const j = noNode ? T('Verify the Qersh signature') : T('Qersh Trigger');
	const chat = "={{ $('Settings').item.json.telegram_chat_id }}";
	wf.add(ifNode('Is this the connection test?', pos(col++, 2), [isTrue('t2test', '={{ $json.test === true }}')]));
	wf.connect(src, 'Is this the connection test?');
	wf.add(ifNode('Is this a new transfer?', pos(col, 3), [equals('t2event', '={{ $json.event }}', 'transfer.received')]));
	wf.connect('Is this the connection test?', 'Is this a new transfer?', 1);
	if (noNode) {
		wf.add(noOp('Nothing to send for the test', pos(col, 1)));
		wf.connect('Is this the connection test?', 'Nothing to send for the test', 0);
	}
	col++;
	wf.add(dataTable('Skip a repeated delivery', pos(col, 2), { operation: 'rowNotExists', filters: { conditions: [{ keyName: 'delivery_id', condition: 'eq', keyValue: '={{ $json.delivery_id }}' }] }, matchType: 'anyCondition' }, { alwaysOutputData: true }));
	wf.connect('Is this a new transfer?', 'Skip a repeated delivery', 0);
	wf.add(ifNode('Is the delivery new?', pos(col + 1, 2), [isTrue('t2new', '={{ !$json.isEmpty() }}')]));
	wf.connect('Skip a repeated delivery', 'Is the delivery new?');
	wf.add(dataTable('Remember the delivery', pos(col + 2, 1), { operation: 'insert', columns: mapper({ delivery_id: `={{ ${j}.delivery_id }}`, transfer_id: `={{ ${j}.transfer.transfer_id }}`, amount: `={{ ${j}.transfer.amount }}`, currency: `={{ ${j}.transfer.currency }}`, payer: `={{ ${j}.transfer.payer.number ?? ${j}.transfer.payer.handle ?? '' }}`, received_at: `={{ ${j}.transfer.received_at ?? ${j}.created_at }}` }), options: {} }));
	wf.connect('Is the delivery new?', 'Remember the delivery', 0);
	wf.add(telegram('Send the transfer alert', pos(col + 3, 1), chat, transferAlert(j)));
	wf.connect('Remember the delivery', 'Send the transfer alert');
	wf.add(ifNode('Is it a forgery verdict?', pos(col, 4), [isTrue('t2forgery', '={{ $json.transfer?.suspected_forgery === true }}')]));
	wf.connect('Is this a new transfer?', 'Is it a forgery verdict?', 1);
	wf.add(telegram('Send the forgery warning', pos(col + 1, 4), chat, forgeryAlert('$json')));
	wf.connect('Is it a forgery verdict?', 'Send the forgery warning', 0);
	if (noNode) {
		wf.add(noOp('Already sent', pos(col + 2, 3)));
		wf.connect('Is the delivery new?', 'Already sent', 1);
		wf.add(noOp('Nothing to send', pos(col + 1, 5)));
		wf.connect('Is it a forgery verdict?', 'Nothing to send', 1);
	} else {
		wf.add(replyOk('Reply ok', pos(col + 4, 2)));
		wf.connect('Is this the connection test?', 'Reply ok', 0);
		wf.connect('Send the transfer alert', 'Reply ok');
		wf.connect('Is the delivery new?', 'Reply ok', 1);
		wf.connect('Send the forgery warning', 'Reply ok');
		wf.connect('Is it a forgery verdict?', 'Reply ok', 1);
	}
	wf.sticky(
		mainNote(
			'Send a Telegram alert for every wallet transfer',
			(noNode
				? 'The Qersh app on the merchant\'s phone posts every incoming wallet transfer (Vodafone Cash, Orange Cash, e& money, InstaPay) to the Webhook node as a signed JSON delivery. The Code node checks the signature on the raw body and refuses anything else with 401; a valid delivery is answered with 200 at once. '
				: 'The Qersh app on the merchant\'s phone posts every incoming wallet transfer (Vodafone Cash, Orange Cash, e& money, InstaPay) to the Qersh Trigger as a signed JSON delivery; the trigger verifies the signature and refuses anything else with 401. ') +
				'The connection test gets no message. A new transfer is remembered by delivery_id in a Data table, so the phone\'s retries never send the alert twice; then a Telegram message goes out with the amount, payer, wallet, transaction id and risk. A later "suspected forgery" verdict sends a warning so nobody ships against that money.',
			(noNode ? SETUP_COMMON_NO_NODE : SETUP_COMMON)(
				'2. In Settings, put the chat id that should get the alerts (send /start to your bot, then read the chat id from the Telegram Trigger). Select your Telegram bot credential in both Telegram nodes.\n3. Create a Data table qersh_deliveries with the text columns delivery_id, transfer_id, amount, currency, payer, received_at and select it in both Data table nodes.\n4. ',
			),
			'Messages are English; translate the two texts freely and keep the digits Latin. Add a message for transfers that need a human check (auto_confirm_ok is false).',
		),
		[-X * 2.2, -Y * 0.6],
		480,
		noNode ? 820 : 760,
		1,
	);
	wf.sticky(section('Verify and route', noNode ? 'The Code node checks the signature; Settings holds the key and the chat id; the If nodes pick the branch.' : 'The trigger verified the signature; Settings holds the chat id; the If nodes pick the branch: test, new transfer, or a later verdict.'), [noNode ? X * 1.6 : -X * 0.4, Y * 0.8], noNode ? X * 3.9 : X * 3.9, Y * 1.1, 7);
	wf.sticky(section('Alert once', 'The Data table remembers each delivery_id. A retry or a backfill of the same delivery is skipped.'), [pos(col, 2)[0] - 40, Y * 1.5 + 20], X * 4.2, Y * 1.4, 7);
	wf.sticky(section('Forgery verdict', 'transfer.updated with suspected_forgery: warn the merchant before anything ships.'), [pos(col, 4)[0] - 40, Y * 3.6], X * 2.2, Y * 1.2, 7);
	if (noNode) wf.sticky(KEY_WARNING, [X * 0.8, Y * 2.6], 300, 200, 3);
	return wf;
}

// ── T3 · Confirm store orders from wallet transfers ────────────────────────────────────────────────────────────────
function t3(variant) {
	const noNode = variant === 'webhook-code';
	const wf = new Workflow(noNode ? 'Confirm store orders from wallet transfers (Webhook + Code)' : 'Confirm store orders from wallet transfers', 't3:' + variant);
	let col = 0;
	let src;
	const store = "$('Settings').item.json.store_base_url";
	if (noNode) {
		webhookNode(wf, pos(col++, 2));
		wf.add(setFields('Settings', pos(col++, 2), [{ name: 'connection_key', value: KEY_PLACEHOLDER }, { name: 'store_base_url', value: 'https://your-store.example' }], { keepInput: true }));
		wf.add(code('Verify the Qersh signature', pos(col++, 2), VERIFY_CODE));
		wf.add(ifNode('Is the signature valid?', pos(col++, 2), [isTrue('t3valid', '={{ $json.valid === true }}')]));
		wf.add(respond('Reply 401 to a bad signature', pos(col, 4), '={{ JSON.stringify({ error: "invalid_signature", reason: $json.reason }) }}', 401));
		wf.connect('Webhook', 'Settings');
		wf.connect('Settings', 'Verify the Qersh signature');
		wf.connect('Verify the Qersh signature', 'Is the signature valid?');
		wf.connect('Is the signature valid?', 'Reply 401 to a bad signature', 1);
		src = 'Is the signature valid?';
	} else {
		qershTrigger(wf, pos(col++, 2), ['transfer.received', 'transfer.updated', 'webhook.test']);
		wf.add(setFields('Settings', pos(col++, 2), [{ name: 'store_base_url', value: 'https://your-store.example' }], { keepInput: true }));
		wf.connect('Qersh Trigger', 'Settings');
		src = 'Settings';
	}
	const j = noNode ? T('Verify the Qersh signature') : T('Qersh Trigger');
	const matchNode = 'Match the transfer to an order';
	wf.add(ifNode('Is this the connection test?', pos(col++, 2), [isTrue('t3test', '={{ $json.test === true }}')]));
	wf.connect(src, 'Is this the connection test?', 0);
	wf.add(ifNode('Is this a new transfer?', pos(col, 3), [equals('t3event', '={{ $json.event }}', 'transfer.received')]));
	wf.connect('Is this the connection test?', 'Is this a new transfer?', 1);
	col++;
	wf.add(httpGet("Get the payer's open orders", pos(col, 2), `={{ ${store} }}/qersh/open-orders?payer={{ encodeURIComponent($json.transfer.payer.key ?? '') }}`));
	wf.connect('Is this a new transfer?', "Get the payer's open orders", 0);
	if (noNode) wf.add(code(matchNode, pos(col + 1, 2), MATCH_CODE));
	else
		wf.add({
			parameters: { operation: 'matchTransfer', transfer: `={{ ${j}.transfer }}`, orders: '={{ $json.orders ?? [] }}', options: {} },
			name: matchNode,
			type: NODE_TYPE,
			typeVersion: 1,
			position: pos(col + 1, 2),
		});
	wf.connect("Get the payer's open orders", matchNode);
	wf.add(ifNode('Was an order paid?', pos(col + 2, 2), [condition('t3paid', '={{ $json.action ?? "" }}', { type: 'string', operation: 'notEmpty', singleValue: true })]));
	wf.connect(matchNode, 'Was an order paid?');
	wf.add(httpPost('Mark the order as paid in the store', pos(col + 3, 1), `={{ ${store} }}/qersh/mark-paid`, `={{ JSON.stringify({ order_number: $json.order_number, status: $json.status, amount_minor: $json.amount_minor, transfer_id: $json.transfer_id, provider_txn_id: ${j}.transfer.provider_txn_id, payer: ${j}.transfer.payer.key, received_at: ${j}.transfer.received_at }) }}`));
	wf.connect('Was an order paid?', 'Mark the order as paid in the store', 0);
	wf.add(ifNode('Is it a forgery verdict?', pos(col, 4), [isTrue('t3forgery', '={{ $json.transfer?.suspected_forgery === true }}')]));
	wf.connect('Is this a new transfer?', 'Is it a forgery verdict?', 1);
	wf.add(httpPost('Stop the order in the store', pos(col + 1, 4), `={{ ${store} }}/qersh/stop-order`, '={{ JSON.stringify({ transfer_id: $json.transfer.transfer_id, reason: "suspected_forgery", delivery_id: $json.delivery_id }) }}'));
	wf.connect('Is it a forgery verdict?', 'Stop the order in the store', 0);
	if (noNode) {
		wf.add(respond('Reply ok', pos(col + 2, 4), '{"status":"ok"}'));
		wf.add(respond('Reply with the match result', pos(col + 4, 2), matchReply(matchNode)));
	} else {
		wf.add(replyOk('Reply ok', pos(col + 2, 4)));
		wf.add(setRaw('Reply with the match result', pos(col + 4, 2), matchReply(matchNode)));
	}
	wf.connect('Is this the connection test?', 'Reply ok', 0);
	wf.connect('Stop the order in the store', 'Reply ok');
	wf.connect('Is it a forgery verdict?', 'Reply ok', 1);
	wf.connect('Mark the order as paid in the store', 'Reply with the match result');
	wf.connect('Was an order paid?', 'Reply with the match result', 1);
	wf.sticky(
		mainNote(
			'Confirm store orders from wallet transfers',
			(noNode
				? 'The Qersh app on the merchant\'s phone posts every incoming wallet transfer (Vodafone Cash, Orange Cash, e& money, InstaPay) to the Webhook node as a signed JSON delivery; the Code node checks the signature on the raw body and refuses anything else with 401. '
				: 'The Qersh app on the merchant\'s phone posts every incoming wallet transfer (Vodafone Cash, Orange Cash, e& money, InstaPay) to the Qersh Trigger as a signed JSON delivery; the trigger verifies the signature and refuses anything else with 401. ') +
				'For a new transfer the workflow asks your store for the open orders of that payer, matches the transfer to the order that was open when the money arrived (payer and time decide; the amount only chooses between that payer\'s orders), marks the order paid in the store and answers the phone with {"status":"matched","reference":"ORD-…"}. A later "suspected forgery" verdict stops the order. Your store stays the source of truth and keeps the delivery_id to answer repeats.',
			(noNode ? SETUP_COMMON_NO_NODE : SETUP_COMMON)(
				'2. In Settings, set store_base_url. Your store offers three small endpoints: GET /qersh/open-orders?payer=… returning {"orders":[{order_number, price_minor, paid_minor, payer_key, created_at, expires_at}]}, POST /qersh/mark-paid and POST /qersh/stop-order. Add the store\'s authentication to the HTTP Request nodes with an n8n credential, never a key in the URL.\n3. ',
			),
			'Tune the match node\'s windows (late 120 minutes, skew 10 minutes). Alert someone from the "review" branch. Keep "Send sender details" on "full name and number" in the wallet, or the payer arrives masked and nothing matches.',
		),
		[-X * 2.2, -Y * 0.6],
		480,
		noNode ? 900 : 840,
		1,
	);
	wf.sticky(section('Verify and route', noNode ? 'The Code node checks the signature; Settings holds the key and your store URL; the If nodes pick the branch.' : 'The trigger verified the signature; Settings holds your store URL; the If nodes pick the branch: test, new transfer, or a later verdict.'), [noNode ? X * 1.6 : -X * 0.4, Y * 0.8], X * 3.9, Y * 1.1, 7);
	wf.sticky(section('Match and confirm', 'Your store returns the payer\'s open orders; the match picks the one open when the money arrived; the store marks it paid; the phone gets the result.'), [pos(col, 2)[0] - 40, Y * 1.5 + 20], X * 5.2, Y * 1.4, 7);
	wf.sticky(section('Forgery verdict', 'transfer.updated with suspected_forgery: the store stops the order that transfer paid.'), [pos(col, 4)[0] - 40, Y * 3.6], X * 3.2, Y * 1.2, 7);
	if (noNode) wf.sticky(KEY_WARNING, [X * 0.8, Y * 2.6], 300, 200, 3);
	return wf;
}

export const TEMPLATES = [
	{ file: 't1-log-wallet-transfers-to-google-sheets.json', build: () => t1('qersh-node') },
	{ file: 't1-log-wallet-transfers-to-google-sheets.webhook-code.json', build: () => t1('webhook-code') },
	{ file: 't2-send-a-telegram-alert-for-every-wallet-transfer.json', build: () => t2('qersh-node') },
	{ file: 't2-send-a-telegram-alert-for-every-wallet-transfer.webhook-code.json', build: () => t2('webhook-code') },
	{ file: 't3-confirm-store-orders-from-wallet-transfers.json', build: () => t3('qersh-node') },
	{ file: 't3-confirm-store-orders-from-wallet-transfers.webhook-code.json', build: () => t3('webhook-code') },
];

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	for (const t of TEMPLATES) {
		const json = JSON.stringify(t.build().toJSON(), null, 2) + '\n';
		writeFileSync(path.join(outDir, t.file), json);
		console.log(`wrote templates/${t.file} (${json.length} bytes)`);
	}
}
